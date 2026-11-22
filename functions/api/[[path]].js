// ArabaVS API — Cloudflare Pages Functions + D1
// Yüksek trafik için: havuz + liderlik tablosu edge cache'te tutulur, D1'e sadece oy sayaçları yazılır.

const COLS = `id,brand,model,engine,year,fuel,gear,km,price,body,segment,color,city,
changed_parts,painted_parts,heavy_damage,tramer,note,image_url,shown,wins,haggle,losses,expensive`;
const FUELS = ['benzin', 'dizel', 'lpg', 'hibrit', 'elektrik'];
const GEARS = ['manuel', 'otomatik', 'yari-otomatik'];
const SEGMENTS = ['ekonomi', 'orta', 'ust'];
const BODIES = ['sedan', 'hatchback', 'suv', 'station', 'coupe', 'minivan', 'pickup'];
const CHOICES = ['a', 'b', 'haggle_a', 'haggle_b', 'both_expensive'];

const enc = new TextEncoder();
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
const fail = (msg, status = 400) => json({ error: msg }, status);

// ---------- imza / token ----------
const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
async function sign(secret, payload) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}
async function verify(secret, token) {
  if (!token || !secret) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(unb64u(body)));
    if (p.exp && p.exp < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}
const secretOf = (env) => env.SESSION_SECRET || 'dev-only-secret-change-me';

async function authUser(request, env) {
  const h = request.headers.get('Authorization') || '';
  const p = await verify(secretOf(env), h.replace(/^Bearer /, ''));
  return p && p.uid ? p : null;
}

// ---------- eşleştirme ----------
const weighted = (items, weights) => {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
};

function pickPair(pool) {
  if (pool.length < 2) return null;
  // az gösterilen ilanlara öncelik (yeni ilanlar hızlı veri toplasın)
  const a = weighted(pool, pool.map((l) => 1 / (1 + l.shown / 40)));
  for (const tol of [0.08, 0.15, 0.3, 100]) {
    const cands = pool.filter((l) => l.id !== a.id && Math.abs(l.price - a.price) / a.price <= tol);
    if (!cands.length) continue;
    // fiyat yakın ama tercih değişken olsun: farklı segment / yıl farkı / farklı marka bonus
    const scores = cands.map(
      (l) =>
        (1 + (l.segment !== a.segment ? 3 : 0) + (Math.abs(l.year - a.year) >= 3 ? 2 : 0) + (l.brand !== a.brand ? 1 : 0)) /
        (1 + l.shown / 40)
    );
    const b = weighted(cands, scores);
    return Math.random() < 0.5 ? [a, b] : [b, a];
  }
  return null;
}

async function getPool(env, ctx, request) {
  const cache = caches.default;
  const key = new Request(new URL('/__cache/pool', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM listings WHERE active=1 ORDER BY shown ASC LIMIT 1500`).all();
  ctx.waitUntil(
    cache.put(key, new Response(JSON.stringify(results), { headers: { 'Cache-Control': 'public, max-age=60' } }))
  );
  return results;
}

// ---------- doğrulama ----------
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

function validateListing(b) {
  const year = int(b.year, 1995, new Date().getFullYear() + 1);
  const km = int(b.km, 0, 1500000);
  const price = int(b.price, 50000, 50000000);
  const tramer = int(b.tramer ?? 0, 0, 10000000);
  const changed = int(b.changed_parts ?? 0, 0, 30);
  const painted = int(b.painted_parts ?? 0, 0, 30);
  const brand = str(b.brand, 40);
  const model = str(b.model, 60);
  if (!brand || !model) return { error: 'Marka ve model zorunlu' };
  if (year === null) return { error: 'Yıl geçersiz' };
  if (km === null) return { error: 'KM geçersiz' };
  if (price === null) return { error: 'Fiyat geçersiz (50.000 - 50.000.000 TL)' };
  if (tramer === null || changed === null || painted === null) return { error: 'Hasar bilgileri geçersiz' };
  if (!FUELS.includes(b.fuel)) return { error: 'Yakıt tipi geçersiz' };
  if (!GEARS.includes(b.gear)) return { error: 'Vites geçersiz' };
  if (!SEGMENTS.includes(b.segment)) return { error: 'Segment geçersiz' };
  const body = BODIES.includes(b.body) ? b.body : null;
  let image = str(b.image_url, 300);
  if (image && !/^https:\/\//i.test(image)) image = '';
  return {
    v: {
      brand, model, engine: str(b.engine, 30), year, fuel: b.fuel, gear: b.gear, km, price, body,
      segment: b.segment, color: str(b.color, 20), city: str(b.city, 30),
      changed_parts: changed, painted_parts: painted, heavy_damage: b.heavy_damage ? 1 : 0,
      tramer, note: str(b.note, 200), image_url: image || null,
    },
  };
}

// ---------- ana yönlendirici ----------
export async function onRequest({ request, env, params, waitUntil }) {
  const ctx = { waitUntil };
  const method = request.method;
  const path = '/' + [].concat(params.path || []).join('/');
  try {
    // --- herkese açık ---
    if (path === '/config' && method === 'GET')
      return json({ googleClientId: env.GOOGLE_CLIENT_ID || '' }, 200, { 'Cache-Control': 'public, max-age=300' });

    if (path === '/pair' && method === 'GET') {
      const url = new URL(request.url);
      const qa = parseInt(url.searchParams.get('a'), 10), qb = parseInt(url.searchParams.get('b'), 10);
      let pair;
      if (qa && qb && qa !== qb) {
        // paylaşılan link: belirli bir düello
        const { results } = await env.DB.prepare(`SELECT ${COLS} FROM listings WHERE active=1 AND id IN (?,?)`).bind(qa, qb).all();
        if (results.length === 2) pair = results[0].id === qa ? results : [results[1], results[0]];
      }
      if (!pair) pair = pickPair(await getPool(env, ctx, request));
      if (!pair) return fail('Yeterli ilan yok', 404);
      const token = await sign(secretOf(env), {
        a: pair[0].id, b: pair[1].id, n: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 900,
      });
      return json({ a: pair[0], b: pair[1], token }, 200, { 'Cache-Control': 'no-store' });
    }

    if (path === '/vote' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (!CHOICES.includes(body.choice)) return fail('Geçersiz seçim');
      const t = await verify(secretOf(env), body.token);
      if (!t) return fail('Süre doldu, yeni eşleşme yükleyin', 410);
      // aynı token ile tekrar oy kullanımını engelle (colo bazlı, ucuz)
      const nonceKey = new Request(new URL(`/__cache/n/${t.n}`, request.url).toString());
      if (await caches.default.match(nonceKey)) return fail('Bu oy zaten kullanıldı', 409);
      waitUntil(caches.default.put(nonceKey, new Response('1', { headers: { 'Cache-Control': 'max-age=900' } })));

      const Z = { w: 0, h: 0, l: 0, e: 0 };
      const [forA, forB] = {
        a: [{ ...Z, w: 1 }, { ...Z, l: 1 }],
        b: [{ ...Z, l: 1 }, { ...Z, w: 1 }],
        haggle_a: [{ ...Z, h: 1 }, { ...Z, l: 1 }],
        haggle_b: [{ ...Z, l: 1 }, { ...Z, h: 1 }],
        both_expensive: [{ ...Z, e: 1 }, { ...Z, e: 1 }],
      }[body.choice];
      const sql = `UPDATE listings SET shown=shown+1, wins=wins+?, haggle=haggle+?, losses=losses+?, expensive=expensive+?
                   WHERE id=? RETURNING id,shown,wins,haggle,losses,expensive`;
      const res = await env.DB.batch([
        env.DB.prepare(sql).bind(forA.w, forA.h, forA.l, forA.e, t.a),
        env.DB.prepare(sql).bind(forB.w, forB.h, forB.l, forB.e, t.b),
      ]);
      return json({ a: res[0].results[0], b: res[1].results[0] });
    }

    if (path === '/leaderboard' && method === 'GET') {
      const cache = caches.default;
      const key = new Request(new URL('/__cache/lb', request.url).toString());
      const hit = await cache.match(key);
      if (hit) return new Response(hit.body, hit);
      const min = parseInt(env.MIN_SHOWN || '3', 10);
      const { results } = await env.DB.prepare(
        `SELECT ${COLS}, (wins + 0.5*haggle + 2.5) / (shown + 5.0) AS score
         FROM listings WHERE active=1 AND shown>=? ORDER BY score DESC LIMIT 30`
      ).bind(min).all();
      const res = json({ items: results }, 200, { 'Cache-Control': 'public, max-age=60' });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }

    if (path === '/auth/google' && method === 'POST') {
      const { credential } = await request.json().catch(() => ({}));
      if (!credential || !env.GOOGLE_CLIENT_ID) return fail('Giriş yapılandırılmamış', 400);
      const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
      if (!r.ok) return fail('Google doğrulaması başarısız', 401);
      const g = await r.json();
      if (g.aud !== env.GOOGLE_CLIENT_ID) return fail('Geçersiz istemci', 401);
      await env.DB.prepare(
        `INSERT INTO users (google_sub,name,email,created_at) VALUES (?,?,?,?)
         ON CONFLICT(google_sub) DO UPDATE SET name=excluded.name, email=excluded.email`
      ).bind(g.sub, g.name || '', g.email || '', Date.now()).run();
      const u = await env.DB.prepare('SELECT id,name FROM users WHERE google_sub=?').bind(g.sub).first();
      const token = await sign(secretOf(env), { uid: u.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 });
      return json({ token, user: { id: u.id, name: u.name } });
    }

    // --- giriş gerektirenler ---
    const me = await authUser(request, env);
    if (!me) return fail('Giriş gerekli', 401);

    if (path === '/my/listings' && method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT ${COLS}, (SELECT COUNT(*)+1 FROM listings x WHERE x.active=1 AND x.shown>=3 AND
           (x.wins+0.5*x.haggle+2.5)/(x.shown+5.0) > (l.wins+0.5*l.haggle+2.5)/(l.shown+5.0)) AS rank
         FROM listings l WHERE owner_id=? AND active=1 ORDER BY created_at DESC`
      ).bind(me.uid).all();
      return json({ items: results });
    }

    if (path === '/listings' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { v, error } = validateListing(body);
      if (error) return fail(error);
      const cnt = await env.DB.prepare('SELECT COUNT(*) c FROM listings WHERE owner_id=? AND active=1').bind(me.uid).first();
      if (cnt.c >= 10) return fail('En fazla 10 aktif ilan ekleyebilirsin', 429);
      const r = await env.DB.prepare(
        `INSERT INTO listings (owner_id,brand,model,engine,year,fuel,gear,km,price,body,segment,color,city,
           changed_parts,painted_parts,heavy_damage,tramer,note,image_url,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(me.uid, v.brand, v.model, v.engine, v.year, v.fuel, v.gear, v.km, v.price, v.body, v.segment,
        v.color, v.city, v.changed_parts, v.painted_parts, v.heavy_damage, v.tramer, v.note, v.image_url, Date.now()).run();
      return json({ id: r.meta.last_row_id }, 201);
    }

    const del = path.match(/^\/listings\/(\d+)$/);
    if (del && method === 'DELETE') {
      await env.DB.prepare('UPDATE listings SET active=0 WHERE id=? AND owner_id=?').bind(+del[1], me.uid).run();
      return json({ ok: true });
    }

    return fail('Bulunamadı', 404);
  } catch (e) {
    return fail('Sunucu hatası: ' + e.message, 500);
  }
}
