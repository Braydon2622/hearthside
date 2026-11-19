// The residents. Each one has a home, wanders between plazas along the paths,
// stops to idle, goes home at night, and hops with curiosity when an icon lands nearby.
(function (HS) {
  const CS = HS.CS;
  const TUNICS = ['#c4553f', '#3f7f86', '#d9a441', '#6d6f9c', '#7a9a4a', '#b5657c', '#e6e0d0', '#4f6fa8'];
  const HAIR = ['#3a2a20', '#6b4a2b', '#1f1b1a', '#a9652f', '#d8d2c4'];
  const SKIN = ['#f1cfa8', '#e0b48a', '#c99772'];

  HS.Villagers = function (world) {
    this.world = world;
    this.list = [];
    this.rand = HS.rng(99);
    this.sync();
  };
  const P = HS.Villagers.prototype;

  P.activeHouses = function () { return this.world.allHouses().filter((h) => h.target === 1); };

  P.spawn = function (kind) {
    const r = this.rand, w = this.world, homes = this.activeHouses();
    const home = homes.length ? homes[Math.floor(r() * homes.length)] : null;
    const spot = !home && w.spots.length ? w.spots[Math.floor(r() * w.spots.length)] : null;
    const p = home ? w.cellCenter(home.door) : spot ? { x: spot.x, y: spot.y } : { x: w.width / 2, y: w.height / 2 };
    const v = {
      kind, home, x: p.x, y: p.y, ox: (r() - 0.5) * 10, oy: (r() - 0.5) * 8,
      state: 'idle', timer: r() * 4, path: null, pi: 0, goingHome: false, goal: null, dest: null,
      speed: kind === 'cat' ? 46 : 24 + r() * 12, phase: r() * 6, hop: 0, face: 1, look: r() * 6,
      owl: r() < 0.2, tunic: TUNICS[Math.floor(r() * TUNICS.length)], hair: HAIR[Math.floor(r() * HAIR.length)],
      skin: SKIN[Math.floor(r() * SKIN.length)], hat: r() < 0.3, fur: ['#3a3532', '#d98b3a', '#e9e4da'][Math.floor(r() * 3)],
    };
    this.list.push(v);
    return v;
  };

  // Keep the population in step with how many icon plazas there are.
  P.sync = function () {
    const want = HS.clamp(6 + this.world.clusters.length * 2, 8, 15);
    const people = this.list.filter((v) => v.kind === 'person').length;
    for (let i = people; i < want; i++) this.spawn('person');
    if (!this.list.some((v) => v.kind === 'cat')) this.spawn('cat');
  };

  // The world just rearranged: everyone re-plans, and those near the drop get curious.
  P.worldChanged = function (drop) {
    const w = this.world, r = this.rand;
    this.sync();
    for (const v of this.list) {
      if (v.state === 'walk') { v.state = 'idle'; v.timer = 0.2 + r() * 0.8; v.path = null; }
      if (drop && v.state !== 'inside' && Math.hypot(v.x - drop.x, v.y - drop.y) < 190) {
        v.hop = 0.75 + r() * 0.3;
        let best = null, bd = Infinity;
        for (const s of w.spots) {
          const d = Math.hypot(s.x - drop.x, s.y - drop.y) + r() * 30;
          if (d < bd) { bd = d; best = s; }
        }
        v.goal = best; v.timer = Math.min(v.timer, 0.3);
      }
    }
  };

  P.pickGoal = function (v, night) {
    const w = this.world, r = this.rand;
    v.goingHome = false;
    const at = (c) => { const p = w.cellCenter(c); return { cell: c, x: p.x, y: p.y, loose: true }; };
    if (v.goal) { const g = v.goal; v.goal = null; if (!w.blocked[g.cell]) return g; }
    if (v.kind === 'person' && night > 0.65 && !v.owl) {
      if (!v.home || v.home.target !== 1) { const hs = this.activeHouses(); v.home = hs.length ? hs[Math.floor(r() * hs.length)] : null; }
      if (v.home) { v.goingHome = true; const d = at(v.home.door); d.loose = false; return d; }
    }
    if (v.kind === 'person' && w.spots.length && r() < 0.7) return w.spots[Math.floor(r() * w.spots.length)];
    // otherwise a short wander nearby
    const cx = Math.floor(v.x / CS), cy = Math.floor(v.y / CS), maxRow = Math.floor((w.height - HS.TASKBAR - 6) / CS);
    for (let i = 0; i < 12; i++) {
      const x = cx + Math.floor((r() - 0.5) * 18), y = cy + Math.floor((r() - 0.5) * 14);
      if (x < 1 || y < 1 || x >= w.W - 1 || y >= maxRow) continue;
      const c = y * w.W + x;
      if (w.blocked[c]) continue;
      if (w.distT[c] > 0.5) { if (w.lane[c]) { const p = w.walkPoint(c); return { cell: c, x: p.x, y: p.y, loose: false }; } continue; }
      if (w.village[c] > 0.5 || w.pathT[c] > 0.5 || w.plazaT[c] > 0.5) return at(c);
    }
    return null;
  };

  P.step = function (dt, night) {
    const w = this.world, r = this.rand;
    for (const v of this.list) {
      v.look += dt;
      if (v.hop > 0) { v.hop -= dt; continue; }

      if (v.state === 'inside') {
        const evicted = !v.home || v.home.target !== 1;
        if (evicted || night < 0.35) { v.timer -= dt; if (evicted || v.timer <= 0) { v.state = 'idle'; v.timer = 0.5 + r(); } }
        continue;
      }

      if (v.state === 'idle') {
        v.timer -= dt;
        if (v.timer > 0) continue;
        const goal = this.pickGoal(v, night);
        const path = goal ? w.walkRoute(w.cellOf(v.x, v.y), goal.cell) : null;
        if (path && path.length > 1) { v.path = path; v.pi = 1; v.dest = goal; v.state = 'walk'; }
        else if (path && v.goingHome) { v.state = 'inside'; v.timer = 2 + r() * 20; }
        else v.timer = 1 + r() * 3;
        continue;
      }

      // walking
      const last = v.pi === v.path.length - 1;
      // the last step goes to the exact spot; steps before it follow the cells (or lanes) of the route
      const p = last ? v.dest : w.walkPoint(v.path[v.pi]);
      const tx = p.x + (last && v.dest.loose ? v.ox : 0), ty = p.y + (last && v.dest.loose ? v.oy : 0);
      const dx = tx - v.x, dy = ty - v.y, d = Math.hypot(dx, dy), stepLen = v.speed * dt;
      if (Math.abs(dx) > 0.5) v.face = dx > 0 ? 1 : -1;
      v.phase += dt * (v.kind === 'cat' ? 14 : 9);
      if (d <= stepLen) {
        v.x = tx; v.y = ty;
        if (last) {
          if (v.goingHome && v.home && v.home.target === 1) { v.state = 'inside'; v.timer = 2 + r() * 25; }
          else { v.state = 'idle'; v.timer = (v.kind === 'cat' ? 4 : 3) + r() * 7; }
        } else v.pi++;
      } else { v.x += dx / d * stepLen; v.y += dy / d * stepLen; }
    }
  };

  HS.drawVillager = function (g, v) {
    const walking = v.state === 'walk' && v.hop <= 0;
    const lift = v.hop > 0 ? Math.abs(Math.sin(v.hop * 10)) * 7 : 0;
    const x = v.x, y = v.y - lift;
    g.fillStyle = 'rgba(30,45,30,.25)';
    g.beginPath(); g.ellipse(v.x, v.y + 1, v.kind === 'cat' ? 6 : 5.5, 2.3, 0, 0, 7); g.fill();

    if (v.kind === 'cat') {
      const f = v.face, run = walking ? Math.sin(v.phase) * 2 : 0;
      g.strokeStyle = HS.tc(v.fur); g.lineWidth = 2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x - 5 * f, y - 5); g.quadraticCurveTo(x - 10 * f, y - 8, x - 9 * f, y - 12 + Math.sin(v.look * 2) * 1.5); g.stroke(); // tail
      g.beginPath(); g.moveTo(x - 3, y - 3); g.lineTo(x - 3 + run, y); g.moveTo(x + 3, y - 3); g.lineTo(x + 3 - run, y); g.stroke();
      g.fillStyle = HS.tc(v.fur);
      g.beginPath(); g.ellipse(x, y - 5, 6, 3.4, 0, 0, 7); g.fill();
      g.beginPath(); g.arc(x + 5.5 * f, y - 8, 3.2, 0, 7); g.fill();
      g.beginPath(); g.moveTo(x + 3.5 * f, y - 10); g.lineTo(x + 4 * f, y - 13.5); g.lineTo(x + 5.8 * f, y - 10.5);
      g.moveTo(x + 6 * f, y - 10.5); g.lineTo(x + 7.8 * f, y - 13.5); g.lineTo(x + 8 * f, y - 9.5); g.fill();
      return;
    }

    const bob = walking ? Math.abs(Math.sin(v.phase)) * 1.4 : 0;
    const swing = walking ? Math.sin(v.phase) * 2.6 : 0;
    const turn = walking ? v.face * 0.8 : Math.sin(v.look * 0.7) * 1.2;   // idle villagers look around
    g.strokeStyle = HS.tc('#4a3a30'); g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x - 2, y - 6); g.lineTo(x - 2 + swing, y); g.moveTo(x + 2, y - 6); g.lineTo(x + 2 - swing, y); g.stroke();
    g.fillStyle = HS.tc(v.tunic);
    g.beginPath(); g.roundRect(x - 4.8, y - 17 - bob, 9.6, 12, 3.5); g.fill();
    g.fillStyle = HS.tc(v.skin);
    g.beginPath(); g.arc(x + turn * 0.5, y - 21 - bob, 4.6, 0, 7); g.fill();
    if (v.hat) {
      g.fillStyle = HS.tc('#e3c779');
      g.beginPath(); g.ellipse(x + turn * 0.5, y - 23.5 - bob, 7.5, 2.4, 0, 0, 7); g.fill();
      g.beginPath(); g.arc(x + turn * 0.5, y - 24.5 - bob, 3.6, Math.PI, 0); g.fill();
    } else {
      g.fillStyle = HS.tc(v.hair);
      g.beginPath(); g.arc(x + turn * 0.5 - turn * 0.6, y - 22 - bob, 4.7, Math.PI * 0.95, Math.PI * 2.05); g.fill();
    }
  };
})(window.HS);
