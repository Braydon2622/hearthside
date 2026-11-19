// The creatures of the code-art world, all built from code: lines, joints and text characters.
//
//   walkers   long-legged eight-legged things. Each leg is a two-bone limb solved every frame
//             (hip, knee, foot); feet stay planted until the body has moved too far from them, then
//             step, in two alternating groups, so the gait reads as real walking. They wander the
//             paths between icon groups, gather on the open ground round the icons, come to look
//             where an icon was dropped, and edge toward the mouse cursor when it is near.
//   jellies   pulsing bells with trailing tentacle chains, drifting slowly through the open void
//             and turning away from icons.
//   moth      a swarm of text characters holding the shape of a flapping moth, wandering high up.
//   packets   small lights running along the paths, leaving comet tails in the trail picture.
//   ripples   rings spreading from where an icon was dropped.
// Everything is drawn into the renderer's "moving" lists every frame; the trail picture behind them
// keeps a fading ghost of earlier frames.
(function (HS) {
  const TAU = Math.PI * 2;
  const rot = (x, y, c, s) => [x * c - y * s, x * s + y * c];

  // Round off a list of points into a smooth line (corner cutting).
  function smooth(pts, passes) {
    for (let it = 0; it < passes && pts.length > 2; it++) {
      const out = [pts[0]];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  }

  // --- walkers ----------------------------------------------------------------------------------
  function Walker(world, x, y, s, rand) {
    this.world = world; this.x = x; this.y = y; this.s = s; this.rand = rand;
    this.head = rand() * TAU; this.vx = 0; this.vy = 0; this.speed = 30 + rand() * 14;
    this.state = 'idle'; this.timer = rand() * 3; this.route = null; this.breath = rand() * 6;
    this.legs = [];
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1, k = i % 4;
      const leg = { side, k, group: (k + (side > 0 ? 1 : 0)) % 2, step: 0, from: null, to: null };
      const r = this.rest(leg, this.head);
      leg.fx = r.x; leg.fy = r.y;
      this.legs.push(leg);
    }
  }
  // where a foot wants to be, for a body at (this.x, this.y) facing ang
  Walker.prototype.rest = function (leg, ang, lead) {
    const s = this.s, c = Math.cos(ang), sn = Math.sin(ang);
    const fwd = (1.5 - leg.k) * 13 * s + (lead || 0), lat = leg.side * (24 + (leg.k === 1 || leg.k === 2 ? 6 : 0)) * s;
    const [dx, dy] = rot(fwd, lat, c, sn);
    return { x: this.x + dx, y: this.y + dy };
  };
  Walker.prototype.hip = function (leg) {
    const [dx, dy] = rot((1.5 - leg.k) * 2.2 * this.s, leg.side * 2.6 * this.s, Math.cos(this.head), Math.sin(this.head));
    return { x: this.x + dx, y: this.y + dy };
  };

  Walker.prototype.goTo = function (gx, gy, direct) {
    const w = this.world;
    if (direct) { this.route = [{ x: this.x, y: this.y }, { x: gx, y: gy }]; }
    else {
      const path = w.walkRoute(w.cellOf(this.x, this.y), w.cellOf(gx, gy));
      if (!path || path.length < 2) return false;
      const pts = [{ x: this.x, y: this.y }];
      for (let i = 1; i < path.length - 1; i++) { const p = w.walkPoint(path[i]); pts.push({ x: p.x, y: p.y }); }
      pts.push({ x: gx, y: gy });
      this.route = smooth(pts, 2);
    }
    this.ri = 1; this.state = 'walk'; this.walkT = 0;
    return true;
  };

  Walker.prototype.step = function (dt, eco) {
    const w = this.world, r = this.rand;
    this.breath += dt;
    const cur = eco.cursor;
    // the cursor: walkers close to it come and stand at a respectful distance, facing it
    const toCur = cur.active ? Math.hypot(cur.x - this.x, cur.y - this.y) : Infinity;
    if (toCur < 260 && toCur > 70 && (this.state !== 'walk' || this.cursorBound)) {
      const a = Math.atan2(this.y - cur.y, this.x - cur.x);
      this.goTo(cur.x + Math.cos(a) * 58, cur.y + Math.sin(a) * 58, true); this.cursorBound = true;
    } else if (this.cursorBound && toCur > 320) { this.cursorBound = false; this.state = 'idle'; this.timer = 0.5; }

    let mvx = 0, mvy = 0;
    if (this.state === 'idle') {
      this.timer -= dt;
      if (this.cursorBound && cur.active) this.turnTo(Math.atan2(cur.y - this.y, cur.x - this.x), dt, 3);
      else if (Math.sin(this.breath * 0.4) > 0.97) this.head += dt * 0.6;          // an occasional look round
      if (this.timer <= 0 && !this.cursorBound) {
        const g = eco.pickSpot(this, r);
        if (!g || !this.goTo(g.x, g.y, false)) this.timer = 1 + r() * 2;
      }
    } else {
      this.walkT += dt;
      const rt = this.route;
      let step = this.speed * dt * Math.min(1, 0.3 + this.walkT * 1.5);
      while (step > 0 && this.ri < rt.length) {
        const p = rt[this.ri], dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy);
        if (d < 0.01) { this.ri++; continue; }
        const m = Math.min(step, d);
        this.x += dx / d * m; this.y += dy / d * m; mvx += dx / d * m; mvy += dy / d * m;
        step -= m; if (m >= d) this.ri++;
      }
      if (mvx || mvy) this.turnTo(Math.atan2(mvy, mvx), dt, 6);
      if (this.ri >= rt.length) { this.state = 'idle'; this.timer = this.cursorBound ? 0.5 : 2 + r() * 6; }
    }
    this.vx = mvx / Math.max(dt, 1e-3); this.vy = mvy / Math.max(dt, 1e-3);

    // feet: a foot steps when the body has carried its resting place too far away; only one group
    // of legs steps at a time
    const lead = Math.min(10, Math.hypot(this.vx, this.vy) * 0.22) * this.s;
    const stepping = [false, false];
    for (const leg of this.legs) if (leg.step > 0) stepping[leg.group] = true;
    for (const leg of this.legs) {
      if (leg.step > 0) {
        leg.step = Math.max(0, leg.step - dt / 0.13);
        const t = 1 - leg.step, e = t * t * (3 - 2 * t);
        leg.fx = leg.from.x + (leg.to.x - leg.from.x) * e; leg.fy = leg.from.y + (leg.to.y - leg.from.y) * e;
        leg.lift = Math.sin(t * Math.PI);
        continue;
      }
      leg.lift = 0;
      const want = this.rest(leg, this.head, lead), d = Math.hypot(want.x - leg.fx, want.y - leg.fy);
      if (d > 13 * this.s && !stepping[1 - leg.group]) {
        leg.from = { x: leg.fx, y: leg.fy }; leg.to = want; leg.step = 1; stepping[leg.group] = true;
      }
    }
  };
  Walker.prototype.turnTo = function (ang, dt, rate) {
    let d = ang - this.head;
    while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
    this.head += d * Math.min(1, dt * rate);
  };

  Walker.prototype.draw = function (L, P) {
    const s = this.s, L1 = 19 * s, L2 = 21 * s, bob = Math.sin(this.breath * 2.2) * 0.6;
    for (const leg of this.legs) {
      const h = this.hip(leg);
      let fx = leg.fx - h.x, fy = leg.fy - h.y, d = Math.hypot(fx, fy);
      const reach = (L1 + L2) * 0.97;
      if (d > reach) { fx *= reach / d; fy *= reach / d; d = reach; }
      const ux = fx / (d || 1), uy = fy / (d || 1);
      const a = (L1 * L1 - L2 * L2 + d * d) / (2 * (d || 1)), hh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      // of the two places the knee could be, take the one further from the body (legs bow outward),
      // and raise it a little, more while the foot is in the air
      const mx = h.x + ux * a, my = h.y + uy * a;
      let kx = mx - uy * hh, ky = my + ux * hh;
      if (Math.hypot(mx + uy * hh - this.x, my - ux * hh - this.y) > Math.hypot(kx - this.x, ky - this.y)) { kx = mx + uy * hh; ky = my - ux * hh; }
      ky -= (leg.lift || 0) * 6 * s + 5 * s;
      const ex = h.x + fx, ey = h.y + fy;
      // a smooth curve through hip, knee and foot
      const cx = 2 * kx - (h.x + ex) / 2, cy = 2 * ky - (h.y + ey) / 2, pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6, u = 1 - t;
        pts.push({ x: u * u * h.x + 2 * u * t * cx + t * t * ex, y: u * u * h.y + 2 * u * t * cy + t * t * ey + bob * u });
      }
      L.path(pts, 0.65, 2, P.line, P.line2, 0.8);
      L.dot(kx, ky + bob * 0.5, 0.9, 2, P.line, 0.7);
      L.dot(ex, ey, 1.1, 2.6, P.joint, leg.lift ? 0.5 : 0.9);
    }
    // body: two rotated squares and a bright heart, like a little machine
    const c = Math.cos(this.head + 0.785), sn = Math.sin(this.head + 0.785);
    const sq = (r, col, a, w) => {
      const p = [[-r, -r], [r, -r], [r, r], [-r, r]].map(([x, y]) => { const [dx, dy] = rot(x, y, c, sn); return { x: this.x + dx, y: this.y + dy + bob }; });
      for (let i = 0; i < 4; i++) L.add(p[i].x, p[i].y, p[(i + 1) % 4].x, p[(i + 1) % 4].y, w, 2.5, col, a);
    };
    sq(5.2 * s, P.star, 0.85, 0.8);
    const [hx, hy] = rot(7 * s, 0, Math.cos(this.head), Math.sin(this.head));
    L.dot(this.x + hx, this.y + hy + bob, 2.4 * s, 4, P.joint, 1);
    L.dot(this.x, this.y + bob, 1.6 * s, 5, P.accent, 0.9);
  };

  // --- jellies ----------------------------------------------------------------------------------
  function Jelly(world, x, y, R, rand) {
    this.world = world; this.x = x; this.y = y; this.R = R; this.rand = rand;
    this.ang = -Math.PI / 2; this.pulse = rand() * TAU; this.vx = 0; this.vy = 0; this.tx = x; this.ty = y; this.timer = 0;
    this.tent = [];
    for (let j = 0; j < 5; j++) { const chain = []; for (let i = 0; i < 8; i++) chain.push({ x, y: y + i * 4 }); this.tent.push(chain); }
  }
  Jelly.prototype.step = function (dt, eco) {
    const f = this.world.field, r = this.rand;
    this.timer -= dt; this.pulse += dt * 2.1;
    if (this.timer <= 0) { const g = eco.openPoint(r, 90); if (g) { this.tx = g.x; this.ty = g.y; } this.timer = 12 + r() * 14; }
    // swim in pulses toward the target, pushed away from icons
    const thrust = Math.max(0, Math.sin(this.pulse)) * 26;
    let ax = this.tx - this.x, ay = this.ty - this.y, d = Math.hypot(ax, ay) || 1;
    ax /= d; ay /= d;
    const near = f.at(this.x, this.y, 1);
    if (near < 90) {
      const gx = f.at(this.x + 10, this.y, 1) - f.at(this.x - 10, this.y, 1), gy = f.at(this.x, this.y + 10, 1) - f.at(this.x, this.y - 10, 1), g = Math.hypot(gx, gy) || 1;
      const k = (90 - near) / 90 * 1.6; ax += gx / g * k; ay += gy / g * k;
    }
    const cur = eco.cursor;
    if (cur.active) { const cx = this.x - cur.x, cy = this.y - cur.y, cd = Math.hypot(cx, cy); if (cd < 150) { ax += cx / cd * 1.2; ay += cy / cd * 1.2; } }
    const want = Math.atan2(ay, ax);
    let da = want - this.ang; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
    this.ang += da * Math.min(1, dt * 0.8);
    this.vx += Math.cos(this.ang) * thrust * dt - this.vx * dt * 1.4;
    this.vy += Math.sin(this.ang) * thrust * dt - this.vy * dt * 1.4;
    this.x += this.vx * dt; this.y += this.vy * dt;
    // tentacles hang from the rim and follow, each link a fixed length behind the one before
    const c = Math.cos(this.ang), s = Math.sin(this.ang), seg = this.R * 0.42;
    this.tent.forEach((chain, j) => {
      const off = (j / 4 - 0.5) * this.R * 1.3;
      chain[0].x = this.x - c * 2 - s * off; chain[0].y = this.y - s * 2 + c * off;
      for (let i = 1; i < chain.length; i++) {
        const p = chain[i], q = chain[i - 1];
        // drift backwards (away from the swimming direction), with a slow wave
        p.x -= c * 6 * dt; p.y -= s * 6 * dt;
        const wv = Math.sin(this.pulse * 0.9 - i * 0.7 + j) * 0.5;
        p.x += -s * wv; p.y += c * wv;
        let dx = p.x - q.x, dy = p.y - q.y; const d2 = Math.hypot(dx, dy) || 1;
        p.x = q.x + dx / d2 * seg; p.y = q.y + dy / d2 * seg;
      }
    });
  };
  Jelly.prototype.draw = function (L, G, P) {
    const R = this.R * (1 - Math.max(0, Math.sin(this.pulse)) * 0.14), c = Math.cos(this.ang), s = Math.sin(this.ang);
    // the bell: a dome bulging the way it swims (local +x), two inner domes, and a scalloped rim
    const at = (lx, ly) => { const [dx, dy] = rot(lx, ly, c, s); return { x: this.x + dx, y: this.y + dy }; };
    const wide = 1 - Math.max(0, Math.sin(this.pulse)) * 0.18;
    for (const [k, a, col] of [[1, 0.75, P.line], [0.7, 0.32, P.line2], [0.42, 0.22, P.line2]]) {
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const t = -Math.PI / 2 + Math.PI * i / 14;
        pts.push(at(Math.cos(t) * R * 1.05 * k, Math.sin(t) * R * wide * k));
      }
      L.path(pts, 0.7, 2.2, col, null, a);
    }
    const rim = [];
    for (let i = 0; i <= 10; i++) { const u = i / 10; rim.push(at(-Math.abs(Math.sin(u * Math.PI * 5)) * 2.2, (u - 0.5) * 2 * R * wide)); }
    L.path(rim, 0.55, 1.8, P.line2, null, 0.5);
    for (const chain of this.tent) {
      L.path(chain, 0.5, 1.8, P.line, P.line2, 0.45);
      const tip = chain[chain.length - 1];
      G.add('·', tip.x, tip.y, 10, P.joint, 0.9);
    }
    L.dot(this.x + c * R * 0.45, this.y + s * R * 0.45, 1.6, 5, P.accent, 0.6);
  };

  // --- the ASCII moth -----------------------------------------------------------------------------
  function Moth(world, rand) {
    this.world = world; this.rand = rand; this.x = world.width * 0.7; this.y = world.height * 0.25;
    this.tx = this.x; this.ty = this.y; this.timer = 0; this.flap = 0; this.parts = [];
    for (let i = 0; i < 34; i++) {
      const t = i / 34 * TAU, e = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t);
      this.parts.push({ ux: Math.sin(t) * e * 12, uy: -Math.cos(t) * e * 10, x: this.x, y: this.y, ch: '+*.+·*'[i % 6] });
    }
  }
  Moth.prototype.step = function (dt, eco) {
    const r = this.rand;
    this.timer -= dt; this.flap += dt * 7;
    if (this.timer <= 0) { const g = eco.openPoint(r, 120); if (g) { this.tx = g.x; this.ty = g.y; } this.timer = 6 + r() * 8; }
    const dx = this.tx - this.x, dy = this.ty - this.y, d = Math.hypot(dx, dy) || 1, sp = Math.min(36, d) * dt;
    this.x += dx / d * sp; this.y += dy / d * sp + Math.sin(this.flap * 0.3) * 0.4;
    const wing = 0.35 + 0.65 * Math.abs(Math.sin(this.flap));
    for (const p of this.parts) {
      const gx = this.x + p.ux * wing, gy = this.y + p.uy;
      p.x += (gx - p.x) * Math.min(1, dt * 9); p.y += (gy - p.y) * Math.min(1, dt * 9);   // each character lags a little
    }
  };
  Moth.prototype.draw = function (L, G, P) {
    for (const p of this.parts) G.add(p.ch, p.x, p.y, 12, P.star, 0.85);
    L.add(this.x, this.y - 12, this.x, this.y + 15, 0.6, 2.5, P.star, 0.8);
    G.add('*', this.x, this.y - 15, 13, P.accent, 1);
  };

  // --- the ecosystem -------------------------------------------------------------------------------
  HS.Creatures = function (world) {
    this.world = world; this.rand = HS.rng(4242);
    this.cursor = { x: 0, y: 0, active: false, last: -1e9 };
    this.ripples = []; this.time = 0;
    this.populate();
  };
  const P_ = HS.Creatures.prototype;

  // A random open point in the void, at least m px from any icon.
  P_.openPoint = function (r, m) {
    const w = this.world, bottom = w.height - HS.TASKBAR - 20;
    for (let i = 0; i < 20; i++) {
      const x = 30 + r() * (w.width - 60), y = 30 + r() * (bottom - 30);
      if (w.field.at(x, y, 1) > m && w.field.at(x, y, 0) > 10) return { x, y };
    }
    return null;
  };
  // Somewhere for a walker to go: usually the open ground near a group of icons, sometimes the void.
  P_.pickSpot = function (wk, r) {
    const w = this.world;
    // open ground beside the icons, never on top of one (icons stay readable)
    const crowded = w.distT.some((v) => v > 0.5);
    const beside = crowded ? w.spots : w.spots.filter((sp) => w.field.at(sp.x, sp.y, 1) > 18);
    if (beside.length && (crowded || r() < 0.65)) {
      const sp = beside[Math.floor(r() * beside.length)];
      return crowded ? { x: sp.x, y: sp.y } : { x: sp.x + (r() - 0.5) * 10, y: sp.y + (r() - 0.5) * 10 };
    }
    for (let i = 0; i < 12; i++) {
      const x = wk.x + (r() - 0.5) * 360, y = wk.y + (r() - 0.5) * 260;
      if (x < 20 || y < 20 || x > w.width - 20 || y > w.height - HS.TASKBAR - 20) continue;
      if (w.field.at(x, y, 1) > 30 && !w.blocked[w.cellOf(x, y)]) return { x, y };
    }
    return null;
  };

  P_.populate = function () {
    const w = this.world, r = this.rand, area = w.width * w.height / (1920 * 1080);
    this.walkers = []; this.jellies = []; this.packets = [];
    // a crowded desktop (a district) gets smaller walkers that keep to the lanes, and drifters only if there is open void
    const crowded = this.crowded = w.distT.some((v) => v > 0.5), size = crowded ? 0.6 : 1;
    const nW = Math.max(3, Math.round((3 + Math.min(4, w.clusters.length)) * Math.sqrt(area)));
    for (let i = 0; i < nW; i++) {
      const sp = w.spots.length ? w.spots[Math.floor(r() * w.spots.length)] : this.openPoint(r, 40) || { x: w.width / 2, y: w.height / 2 };
      this.walkers.push(new Walker(w, sp.x + (crowded ? 0 : (r() - 0.5) * 30), sp.y + (crowded ? 0 : (r() - 0.5) * 30), (1.0 + r() * 0.35) * size, r));
    }
    const nJ = Math.max(2, Math.round(4 * area));
    for (let i = 0; i < nJ; i++) { const p = this.openPoint(r, 90); if (p) this.jellies.push(new Jelly(w, p.x, p.y, 17 + r() * 9, r)); }
    this.moth = new Moth(w, r);
    this.layoutPackets();
    this.layoutOrbiters();
  };
  // Text characters that flow round each group of icons along its contour rings (the inner ring
  // one way, the next the other), like data circling a node.
  P_.layoutOrbiters = function () {
    const w = this.world, f = w.field, r = this.rand, bottom = w.height - HS.TASKBAR - 8;
    const want = Math.round(90 * Math.sqrt(w.width * w.height / (1920 * 1080)));
    this.orbiters = [];
    for (let i = 0; i < 1500 && this.orbiters.length < want; i++) {
      const x = r() * w.width, y = r() * bottom, s = f.smoothAt(x, y, 0);
      if (s < 6 || s > 38) continue;
      const ring = [9, 18, 27, 36][Math.floor(r() * 4)];
      this.orbiters.push({ x, y, ring, dir: ring % 18 ? 1 : -1, speed: 10 + r() * 14, ch: '·.+*:°'[Math.floor(r() * 6)], a: 0.35 + r() * 0.5 });
    }
  };
  // Lights along every path, spaced out, each running end to end and starting again.
  P_.layoutPackets = function () {
    this.packets = [];
    for (const pts of this.world.lines || []) {
      let len = 0; const acc = [0];
      for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); acc.push(len); }
      if (len < 40) continue;
      const n = Math.max(1, Math.round(len / 260));
      for (let k = 0; k < n; k++) this.packets.push({ pts, acc, len, t: (k / n) * len, speed: 50 + this.rand() * 25, dir: k % 2 ? -1 : 1 });
    }
  };

  // The icons changed: lights re-route, walkers re-plan, and those near the drop come and look.
  P_.worldChanged = function (drop) {
    // the desktop went from open to crowded or back: a fresh cast suited to it
    if (this.world.distT.some((v) => v > 0.5) !== this.crowded) { this.populate(); return; }
    this.layoutPackets();
    this.layoutOrbiters();
    for (const wk of this.walkers) {
      if (wk.state === 'walk' && !wk.cursorBound) { wk.state = 'idle'; wk.timer = 0.2 + this.rand() * 0.6; }
      if (drop && Math.hypot(wk.x - drop.x, wk.y - drop.y) < 420 && !wk.cursorBound) {
        wk.goTo(drop.x + (this.rand() - 0.5) * 120, drop.y + 60 + this.rand() * 30, false);
      }
    }
    if (drop) { this.ripples.push({ x: drop.x, y: drop.y, t: 0 }, { x: drop.x, y: drop.y, t: -0.25 }); }
  };

  P_.setCursor = function (x, y) {
    const c = this.cursor;
    if (Math.hypot(x - c.x, y - c.y) > 2) c.last = this.time;
    c.x = x; c.y = y;
  };

  P_.step = function (dt) {
    this.time += dt;
    const c = this.cursor;
    c.active = this.time - c.last < 5;
    for (const wk of this.walkers) wk.step(dt, this);
    // walkers keep a little room between them
    const ws = this.walkers;
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
      const a = ws[i], b = ws[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, room = 48 * (a.s + b.s) / 2;
      if (d < room) { const k = (room - d) * Math.min(1, dt * 2.5) / d; a.x -= dx * k * 0.5; a.y -= dy * k * 0.5; b.x += dx * k * 0.5; b.y += dy * k * 0.5; }
    }
    for (const j of this.jellies) j.step(dt, this);
    // orbiters slide along their ring: across the field's slope, pulled back onto their level
    const f = this.world.field;
    for (const o of this.orbiters) {
      const s = f.smoothAt(o.x, o.y, 0), gx = f.smoothAt(o.x + 3, o.y, 0) - f.smoothAt(o.x - 3, o.y, 0), gy = f.smoothAt(o.x, o.y + 3, 0) - f.smoothAt(o.x, o.y - 3, 0);
      const g = Math.hypot(gx, gy);
      if (g < 0.05) continue;
      const nx = gx / g, ny = gy / g, v = o.speed * dt;
      o.x += -ny * o.dir * v + nx * (o.ring - s) * Math.min(1, dt * 3);
      o.y += nx * o.dir * v + ny * (o.ring - s) * Math.min(1, dt * 3);
    }
    if (this.world.field.at(this.moth.tx, this.moth.ty, 1) > 60) this.moth.step(dt, this);
    for (const p of this.packets) { p.t += p.speed * dt * p.dir; if (p.t > p.len) p.t -= p.len; if (p.t < 0) p.t += p.len; }
    for (let i = this.ripples.length - 1; i >= 0; i--) { this.ripples[i].t += dt; if (this.ripples[i].t > 1.6) this.ripples.splice(i, 1); }
  };

  P_.draw = function (L, G) {
    const P = HS.pal;
    L.reset(); G.reset();
    for (const p of this.packets) {
      const { pts, acc } = p;
      let i = 1; while (i < acc.length - 1 && acc[i] < p.t) i++;
      const t = (p.t - acc[i - 1]) / Math.max(0.001, acc[i] - acc[i - 1]);
      const x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
      L.dot(x, y, 1.6, 4.5, P.accent, 0.95);
    }
    for (const r of this.ripples) {
      if (r.t < 0) continue;
      const k = r.t / 1.6, rad = 20 + k * 260;
      L.circle(r.x, r.y, rad, 0.7, 3, P.contour, (1 - k) * 0.7, 48);
    }
    const oc = HS.mixc(P.contour, P.star, 0.5);
    for (const o of this.orbiters) G.add(o.ch, o.x, o.y, 10, oc, o.a);
    for (const j of this.jellies) j.draw(L, G, P);
    for (const wk of this.walkers) wk.draw(L, P);
    this.moth.draw(L, G, P);
    // the cursor ring, while any walker is paying attention
    const cur = this.cursor;
    if (cur.active && this.walkers.some((wk) => wk.cursorBound)) {
      const a = Math.min(1, (5 - (this.time - cur.last)) / 1.5) * 0.7;
      L.circle(cur.x, cur.y, 46, 0.6, 2.5, P.star, a, 40);
      for (let i = 0; i < 4; i++) { const t = i * Math.PI / 2 + this.time * 0.3; L.add(cur.x + Math.cos(t) * 50, cur.y + Math.sin(t) * 50, cur.x + Math.cos(t) * 56, cur.y + Math.sin(t) * 56, 0.6, 2, P.star, a); }
    }
  };
})(window.HS);
