'use strict';
// ---------- yardımcılar ----------
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const TL = (n) => Number(n).toLocaleString('tr-TR') + ' TL';
const NUM = (n) => Number(n).toLocaleString('tr-TR');
const LBL = {
  fuel: { benzin: 'Benzin', dizel: 'Dizel', lpg: 'Benzin + LPG', hibrit: 'Hibrit', elektrik: 'Elektrik' },
  gear: { manuel: 'Manuel', otomatik: 'Otomatik', 'yari-otomatik': 'Yarı otomatik' },
  body: { sedan: 'Sedan', hatchback: 'Hatchback', suv: 'SUV', station: 'Station', coupe: 'Coupe', minivan: 'Minivan', pickup: 'Pickup' },
  segment: { ekonomi: 'Ekonomi', orta: 'Orta segment', ust: 'Üst segment' },
};
const COLORS = { Beyaz: '#e8ecf1', Siyah: '#1b1e24', Gri: '#7b838f', 'Gümüş': '#aab2bd', Kırmızı: '#c0392b', Mavi: '#2f6fb5', Lacivert: '#1f3560', Yeşil: '#2e7d57', Sarı: '#e0b020', Turuncu: '#e07b20' };

const state = { api: null, demo: false, cfg: {}, pair: null, next: null, voted: false, votes: 0, user: null };
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------- API katmanı (gerçek / demo) ----------
async function call(path, opts = {}) {
  const token = store.get('avs_token', null);
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('json')) throw new Error('NO_API');
  const data = await r.json();
  if (!r.ok) { const e = new Error(data.error || 'Hata'); e.status = r.status; throw e; }
  return data;
}
const RealAPI = {
  config: () => call('/config'),
  pair: (q) => call('/pair' + (q ? `?a=${q.a}&b=${q.b}` : '')),
  vote: (token, choice) => call('/vote', { method: 'POST', body: { token, choice } }),
  leaderboard: () => call('/leaderboard'),
  login: (credential) => call('/auth/google', { method: 'POST', body: { credential } }),
  myListings: () => call('/my/listings'),
  createListing: (b) => call('/listings', { method: 'POST', body: b }),
  deleteListing: (id) => call('/listings/' + id, { method: 'DELETE' }),
};

// ---------- kart ----------
function badge(kind, text) { return h('span', { class: 'badge ' + kind }, text); }
function carImage(l) {
  const c = COLORS[l.color] || '#3a4150';
  const box = h('div', { class: 'img', style: `--c:${c}` });
  if (l.image_url) {
    const im = h('img', { src: l.image_url, alt: `${l.brand} ${l.model}`, loading: 'lazy', referrerpolicy: 'no-referrer' });
    im.onerror = () => im.remove();
    box.append(im);
  }
  box.append(h('div', { class: 'ph' }, h('span', {}, '🚗'), h('em', {}, l.brand)));
  return box;
}
function carCard(l, side) {
  const dmg = l.heavy_damage ? badge('bad', 'Ağır hasar kaydı VAR') : badge('good', 'Ağır hasar yok');
  const chg = l.changed_parts ? badge('warn', `${l.changed_parts} değişen parça`) : badge('good', 'Değişen yok');
  const pnt = l.painted_parts ? badge('warn', `${l.painted_parts} boyalı parça`) : badge('good', 'Boyasız');
  const trm = l.tramer ? badge('warn', 'Tramer ' + TL(l.tramer)) : badge('good', 'Tramer yok');
  return h('article', { class: 'car ' + side, 'data-id': l.id },
    carImage(l),
    h('div', { class: 'body' },
      h('div', { class: 'row between' },
        h('h2', {}, `${l.brand} ${l.model}`),
        h('span', { class: 'seg' }, LBL.segment[l.segment])),
      h('div', { class: 'sub' }, [l.engine, l.city].filter(Boolean).join(' · ')),
      h('div', { class: 'price' }, TL(l.price)),
      h('div', { class: 'specs' },
        spec('Model yılı', l.year), spec('KM', NUM(l.km)),
        spec('Yakıt', LBL.fuel[l.fuel]), spec('Vites', LBL.gear[l.gear]),
        l.body ? spec('Kasa', LBL.body[l.body]) : null, l.color ? spec('Renk', l.color) : null),
      h('div', { class: 'badges' }, dmg, chg, pnt, trm),
      l.note ? h('p', { class: 'note' }, '“' + l.note + '”') : null,
      h('div', { class: 'stat', hidden: true })));
}
const spec = (k, v) => h('div', { class: 'spec' }, h('small', {}, k), h('b', {}, v));

// ---------- VERSUS ----------
async function viewVersus(deep) {
  const root = h('section', { class: 'versus' });
  const app = $('#app'); app.replaceChildren(root);
  root.append(h('div', { class: 'loading' }, 'Eşleşme getiriliyor…'));
  let data;
  try {
    data = (!deep && state.next) || (await state.api.pair(deep));
    state.next = null;
  } catch (e) { root.replaceChildren(h('p', { class: 'empty' }, e.message === 'NO_API' ? 'API bağlanamadı' : 'Eşleşme bulunamadı: ' + e.message)); return; }
  state.pair = data; state.voted = false;
  render();
  state.api.pair().then((d) => { state.next = d; }).catch(() => {}); // sıradakini önceden yükle

  function render() {
    const { a, b } = data;
    const diff = Math.abs(a.price - b.price);
    const cardA = carCard(a, 'a'), cardB = carCard(b, 'b');
    const actions = (side, id) => h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => vote(side) }, 'Bunu alırım'),
      h('button', { class: 'btn ghost', onclick: () => vote('haggle_' + side) }, '🤝 Pazarlıkla alırım'));
    cardA.querySelector('.body').append(actions('a'));
    cardB.querySelector('.body').append(actions('b'));
    const next = h('button', { class: 'btn next', hidden: true, onclick: () => viewVersus() }, 'Sıradaki eşleşme →');
    const share = h('button', { class: 'btn share', hidden: true, onclick: shareIt }, '📤 Paylaş');
    const expensive = h('button', { class: 'btn pricey', onclick: () => vote('both_expensive') }, '💸 İkisi de pahalı');
    root.replaceChildren(
      h('div', { class: 'hint' }, h('b', {}, 'Hangisini alırdın?'), h('span', {}, diff ? ` Fiyat farkı sadece ${TL(diff)}` : ' İkisi de aynı fiyatta')),
      cardA, h('div', { class: 'vs' }, 'VS'), cardB, expensive,
      h('div', { class: 'after' }, next, share));
    window.scrollTo({ top: 0 });
  }

  async function vote(choice) {
    if (state.voted) return; state.voted = true;
    root.classList.add('voted');
    root.querySelectorAll('.btn:not(.next):not(.share)').forEach((b) => (b.disabled = true));
    root.querySelector('.pricey').hidden = true;
    const mark = { a: ['a'], b: ['b'], haggle_a: ['a'], haggle_b: ['b'], both_expensive: [] }[choice];
    mark.forEach((s) => root.querySelector('.car.' + s).classList.add('chosen'));
    try {
      const res = await state.api.vote(data.token, choice);
      for (const [side, st] of [['a', res.a], ['b', res.b]]) {
        const box = root.querySelector(`.car.${side} .stat`);
        const pct = Math.round(((st.wins + 0.5 * st.haggle) / Math.max(1, st.shown)) * 100);
        box.hidden = false;
        box.replaceChildren(
          h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, pct)}%` })),
          h('div', { class: 'row between' },
            h('span', {}, h('b', {}, '%' + pct), ' kazanma'),
            h('span', {}, NUM(st.shown) + ' eşleşme')),
          h('div', { class: 'mini' }, `${NUM(st.wins)} “bunu alırım” · ${NUM(st.haggle)} pazarlık · ${NUM(st.expensive)} “pahalı”`));
      }
      if (choice === 'both_expensive') toast('Not alındı: İkisi de pahalı 💸');
      state.votes++; store.set('avs_votes', (store.get('avs_votes', 0) || 0) + 1); updateStreak();
    } catch (e) { toast(e.status === 410 ? 'Süre doldu, yeni eşleşme geliyor' : 'Oy kaydedilemedi'); if (e.status === 410) return viewVersus(); }
    root.querySelector('.next').hidden = false; root.querySelector('.share').hidden = false;
  }

  async function shareIt() {
    const { a, b } = data;
    const url = location.origin + location.pathname + `#/v/${a.id}-${b.id}`;
    const text = `${TL(a.price)} bütçen var: ${a.brand} ${a.model} (${a.year}) mı, ${b.brand} ${b.model} (${b.year}) mi? Sen hangisini alırdın?`;
    try { if (navigator.share) { await navigator.share({ title: 'İlan Savaşları', text, url }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(text + ' ' + url); toast('Link kopyalandı'); } catch { toast(url); }
  }
}
function updateStreak() {
  const n = store.get('avs_votes', 0) || 0, s = $('#streak');
  s.hidden = !n; s.textContent = '🔥 ' + n + ' oy';
}

// ---------- LİDERLİK ----------
async function viewLeaders() {
  const root = h('section', { class: 'leaders' }, h('h1', {}, 'En çok versus kazananlar'),
    h('p', { class: 'lead' }, 'Sıralama; “bunu alırım” oyları, pazarlık oyları ve toplam eşleşme sayısına göre hesaplanır.'),
    h('div', { class: 'loading' }, 'Yükleniyor…'));
  $('#app').replaceChildren(root);
  try {
    const { items } = await state.api.leaderboard();
    root.querySelector('.loading').remove();
    if (!items.length) { root.append(h('p', { class: 'empty' }, 'Henüz yeterli oy yok. İlk oyları sen ver!')); return; }
    root.append(h('ol', { class: 'lb' }, items.map((l, i) => {
      const pct = Math.round(((l.wins + 0.5 * l.haggle) / Math.max(1, l.shown)) * 100);
      return h('li', { class: i < 3 ? 'top top' + (i + 1) : '' },
        h('div', { class: 'rank' }, i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1),
        h('div', { class: 'info' },
          h('b', {}, `${l.brand} ${l.model} ${l.year}`),
          h('small', {}, [l.engine, LBL.gear[l.gear], NUM(l.km) + ' km', LBL.fuel[l.fuel]].filter(Boolean).join(' · ')),
          h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, pct)}%` }))),
        h('div', { class: 'right' }, h('b', {}, '%' + pct), h('small', {}, NUM(l.shown) + ' maç'), h('small', {}, TL(l.price))));
    })));
  } catch (e) { root.querySelector('.loading').textContent = 'Liste alınamadı'; }
}

// ---------- İLANLARIM ----------
async function viewMe() {
  const root = h('section', { class: 'me' });
  $('#app').replaceChildren(root);
  if (!state.user) {
    root.append(h('h1', {}, 'İlanını versusa sok'),
      h('p', { class: 'lead' }, 'Giriş yap, aracını ekle ve diğer araçlara karşı nasıl performans gösterdiğini canlı izle.'));
    const slot = h('div', { class: 'login' });
    root.append(slot);
    if (state.cfg.googleClientId) await googleButton(slot);
    if (state.demo || !state.cfg.googleClientId) {
      slot.append(h('button', { class: 'btn primary big', onclick: demoLogin }, state.demo ? 'Demo ile devam et' : 'Giriş henüz yapılandırılmadı'));
      if (state.demo) slot.append(h('p', { class: 'small' }, 'Demo modu: veriler sadece bu tarayıcıda tutulur.'));
    }
    return;
  }
  root.append(h('div', { class: 'row between' }, h('h1', {}, 'Merhaba, ' + (state.user.name || '').split(' ')[0]),
    h('button', { class: 'btn ghost sm', onclick: logout }, 'Çıkış')),
    h('button', { class: 'btn primary big', onclick: openForm }, '+ İlan ekle'),
    h('div', { class: 'mylist' }, h('div', { class: 'loading' }, 'Yükleniyor…')));
  try {
    const { items } = await state.api.myListings();
    const list = root.querySelector('.mylist');
    if (!items.length) { list.replaceChildren(h('p', { class: 'empty' }, 'Henüz ilanın yok. İlk ilanını ekle, versuslarda yarışmaya başlasın!')); return; }
    list.replaceChildren(...items.map(myCard));
  } catch (e) {
    if (e.status === 401) return logout();
    root.querySelector('.mylist').textContent = 'Liste alınamadı';
  }
}
function myCard(l) {
  const pct = l.shown ? Math.round(((l.wins + 0.5 * l.haggle) / l.shown) * 100) : null;
  const cell = (k, v) => h('div', {}, h('b', {}, v), h('small', {}, k));
  return h('article', { class: 'mycard' },
    h('div', { class: 'row between' }, h('div', {}, h('b', {}, `${l.brand} ${l.model} ${l.year}`), h('small', { class: 'blk' }, TL(l.price) + ' · ' + NUM(l.km) + ' km')),
      h('button', { class: 'btn ghost sm', onclick: async () => { if (confirm('İlan silinsin mi?')) { await state.api.deleteListing(l.id); viewMe(); } } }, 'Sil')),
    l.shown
      ? h('div', { class: 'perf' },
          cell('Gösterim', NUM(l.shown)), cell('Seçilme', NUM(l.wins)), cell('Pazarlık', NUM(l.haggle)),
          cell('“Pahalı” dendi', NUM(l.expensive)), cell('Kazanma', pct + '%'), cell('Sıran', l.rank ? '#' + l.rank : '—'))
      : h('p', { class: 'small' }, 'Henüz versusa çıkmadı; yeni ilanlar öncelikli gösterilir, birazdan veri gelmeye başlar.'));
}
async function googleButton(slot) {
  if (!window.google) await new Promise((res) => { const s = h('script', { src: 'https://accounts.google.com/gsi/client', async: true }); s.onload = res; s.onerror = res; document.head.append(s); });
  if (!window.google) return;
  google.accounts.id.initialize({
    client_id: state.cfg.googleClientId,
    callback: async ({ credential }) => {
      try { const r = await state.api.login(credential); setUser(r); viewMe(); } catch (e) { toast('Giriş başarısız'); }
    },
  });
  const d = h('div'); slot.append(d);
  google.accounts.id.renderButton(d, { theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill' });
}
async function demoLogin() { const r = await state.api.login(); setUser(r); viewMe(); }
function setUser(r) { store.set('avs_token', r.token); store.set('avs_user', r.user); state.user = r.user; }
function logout() { store.del('avs_token'); store.del('avs_user'); state.user = null; viewMe(); }

// ---------- İLAN FORMU ----------
function openForm() {
  const dlg = h('dialog', { class: 'sheet' });
  const f = (label, name, attrs = {}) => h('label', {}, h('span', {}, label), h('input', { name, ...attrs }));
  const sel = (label, name, opts) => h('label', {}, h('span', {}, label), h('select', { name }, Object.entries(opts).map(([v, t]) => h('option', { value: v }, t))));
  const num = { type: 'text', inputmode: 'numeric', pattern: '[0-9.]*' };
  const err = h('p', { class: 'err' });
  const form = h('form', { method: 'dialog' },
    h('div', { class: 'row between' }, h('h2', {}, 'Yeni ilan'), h('button', { type: 'button', class: 'x', onclick: () => dlg.close() }, '✕')),
    h('fieldset', {}, h('legend', {}, 'Araç'),
      f('Marka', 'brand', { required: true, placeholder: 'Volkswagen', maxlength: 40 }), f('Model', 'model', { required: true, placeholder: 'Passat', maxlength: 60 }),
      f('Motor / paket', 'engine', { placeholder: '1.6 TDI', maxlength: 30 }),
      f('Model yılı', 'year', { ...num, required: true, placeholder: '2015' }),
      f('Kilometre', 'km', { ...num, required: true, placeholder: '120000' }),
      f('Fiyat (TL)', 'price', { ...num, required: true, placeholder: '1300000' }),
      sel('Yakıt', 'fuel', LBL.fuel), sel('Vites', 'gear', LBL.gear), sel('Kasa', 'body', LBL.body),
      sel('Segment', 'segment', LBL.segment), f('Renk', 'color', { placeholder: 'Beyaz', maxlength: 20 }), f('Şehir', 'city', { placeholder: 'İstanbul', maxlength: 30 })),
    h('fieldset', {}, h('legend', {}, 'Durum'),
      f('Değişen parça sayısı', 'changed_parts', { ...num, value: '0' }), f('Boyalı parça sayısı', 'painted_parts', { ...num, value: '0' }),
      f('Tramer (TL)', 'tramer', { ...num, value: '0' }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'heavy_damage' }), h('span', {}, 'Ağır hasar kaydı var'))),
    h('fieldset', {}, h('legend', {}, 'Ekstra'),
      f('Kısa not', 'note', { maxlength: 200, placeholder: 'Bakımları yetkili serviste' }),
      f('Fotoğraf linki (https, isteğe bağlı)', 'image_url', { type: 'url', placeholder: 'https://…' })),
    err, h('button', { class: 'btn primary big', type: 'submit' }, 'Yayınla'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); err.textContent = '';
    const fd = new FormData(form), body = Object.fromEntries(fd.entries());
    for (const k of ['year', 'km', 'price', 'changed_parts', 'painted_parts', 'tramer']) body[k] = Number(String(body[k] || '0').replace(/\./g, ''));
    body.heavy_damage = fd.has('heavy_damage') ? 1 : 0;
    try { await state.api.createListing(body); dlg.close(); toast('İlan yayında! 🎉'); viewMe(); } catch (e) { err.textContent = e.message; }
  });
  dlg.append(form); dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

// ---------- yönlendirme ----------
function route(forced) {
  const hash = (typeof forced === 'string' ? forced : location.hash) || '#/versus';
  const m = hash.match(/^#\/v\/(\d+)-(\d+)$/);
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', hash.startsWith('#/' + (a.dataset.tab === 'versus' ? 'v' : a.dataset.tab))));
  if (m) return viewVersus({ a: m[1], b: m[2] });
  if (hash.startsWith('#/leaders')) return viewLeaders();
  if (hash.startsWith('#/me')) return viewMe();
  return viewVersus();
}
async function boot() {
  try { state.cfg = await RealAPI.config(); state.api = RealAPI; }
  catch { state.demo = true; state.api = window.MockAPI; state.cfg = await MockAPI.config(); document.body.classList.add('demo'); }
  state.user = store.get('avs_user', null);
  if (state.demo && state.user && store.get('avs_token') !== 'demo') state.user = null;
  updateStreak();
  let skip = false;
  addEventListener('hashchange', () => { if (skip) { skip = false; return; } route(); });
  // sekme geçişi hash'e bağımlı olmasın (iframe / kısıtlı ortamlar için)
  document.querySelectorAll('.tabs a').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    const target = a.getAttribute('href');
    try { if (location.hash !== target) { skip = true; location.hash = target; } } catch { skip = false; }
    route(target);
  }));
  route();
}
boot();
