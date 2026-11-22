// DEMO MODU: /api yoksa (ör. dosyayı doğrudan açınca) tarayıcıda çalışan sahte backend.
// Gerçek sitede (Cloudflare) kullanılmaz.
(function () {
  const KEY = 'avs_mock_v1';
  const rnd = (seed) => { let x = Math.sin(seed) * 10000; return x - Math.floor(x); };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

  let S = load();
  if (!S.listings) {
    S.nextId = 1;
    S.listings = (window.SEED || []).map((r) => {
      const id = S.nextId++;
      const shown = Math.round(40 + rnd(id) * 180);
      const score = Math.min(0.8, Math.max(0.12, 0.25 + (r.year - 2010) * 0.025 - r.km / 900000 + (r.heavy_damage ? -0.2 : 0) + (rnd(id + 9) - 0.5) * 0.2));
      const wins = Math.round(shown * score * 0.8), haggle = Math.round(shown * 0.12), expensive = Math.round(shown * 0.06);
      return { ...r, id, owner_id: null, shown, wins, haggle, expensive, losses: Math.max(0, shown - wins - haggle - expensive) };
    });
    save(S);
  }
  const rate = (l) => (l.wins + 0.5 * l.haggle + 2.5) / (l.shown + 5);
  const strip = (l) => { const { owner_id, ...p } = l; return p; };
  const wpick = (items, w) => { let r = Math.random() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; } return items.at(-1); };

  function pickPair(pool) {
    const a = wpick(pool, pool.map((l) => 1 / (1 + l.shown / 40)));
    for (const tol of [0.08, 0.15, 0.3, 100]) {
      const c = pool.filter((l) => l.id !== a.id && Math.abs(l.price - a.price) / a.price <= tol);
      if (!c.length) continue;
      const sc = c.map((l) => (1 + (l.segment !== a.segment ? 3 : 0) + (Math.abs(l.year - a.year) >= 3 ? 2 : 0) + (l.brand !== a.brand ? 1 : 0)) / (1 + l.shown / 40));
      const b = wpick(c, sc);
      return Math.random() < 0.5 ? [a, b] : [b, a];
    }
  }
  const delay = (v) => new Promise((r) => setTimeout(() => r(v), 120));
  const me = () => { try { return JSON.parse(localStorage.getItem('avs_user')); } catch { return null; } };

  window.MockAPI = {
    config: () => delay({ googleClientId: '' }),
    pair(q) {
      const act = S.listings.filter((l) => l.active !== 0);
      let p;
      if (q && q.a && q.b) { const A = act.find((l) => l.id == q.a), B = act.find((l) => l.id == q.b); if (A && B) p = [A, B]; }
      p = p || pickPair(act);
      return delay({ a: strip(p[0]), b: strip(p[1]), token: p[0].id + ':' + p[1].id });
    },
    vote(token, choice) {
      const [ia, ib] = token.split(':').map(Number);
      const A = S.listings.find((l) => l.id === ia), B = S.listings.find((l) => l.id === ib);
      A.shown++; B.shown++;
      if (choice === 'a') { A.wins++; B.losses++; }
      else if (choice === 'b') { B.wins++; A.losses++; }
      else if (choice === 'haggle_a') { A.haggle++; B.losses++; }
      else if (choice === 'haggle_b') { B.haggle++; A.losses++; }
      else { A.expensive++; B.expensive++; }
      save(S);
      const f = (l) => ({ id: l.id, shown: l.shown, wins: l.wins, haggle: l.haggle, losses: l.losses, expensive: l.expensive });
      return delay({ a: f(A), b: f(B) });
    },
    leaderboard() {
      const items = S.listings.filter((l) => l.active !== 0 && l.shown >= 3).map((l) => ({ ...strip(l), score: rate(l) })).sort((x, y) => y.score - x.score).slice(0, 30);
      return delay({ items });
    },
    login() { const u = { id: 1, name: 'Demo Kullanıcı' }; return delay({ token: 'demo', user: u }); },
    myListings() {
      const board = S.listings.filter((l) => l.active !== 0 && l.shown >= 3).sort((x, y) => rate(y) - rate(x)).map((l) => l.id);
      const items = S.listings.filter((l) => l.owner_id === 1 && l.active !== 0).map((l) => ({ ...strip(l), rank: board.indexOf(l.id) + 1 || null }));
      return delay({ items: items.reverse() });
    },
    createListing(body) {
      if (S.listings.filter((l) => l.owner_id === 1 && l.active !== 0).length >= 10) return Promise.reject(new Error('En fazla 10 aktif ilan ekleyebilirsin'));
      const l = { ...body, id: S.nextId++, owner_id: 1, active: 1, shown: 0, wins: 0, haggle: 0, losses: 0, expensive: 0, created_at: Date.now() };
      S.listings.push(l); save(S); return delay({ id: l.id });
    },
    deleteListing(id) { const l = S.listings.find((x) => x.id === id && x.owner_id === 1); if (l) l.active = 0; save(S); return delay({ ok: true }); },
  };
})();
