// The world: a grid of cells covering the screen, the village laid out on it,
// and the rules for how it rearranges around the desktop icons.
(function (HS) {
  const CS = HS.CS;
  const PLAZA_PAD = 16;   // how far open ground extends past an icon, in pixels
  const PATH_HALF = 13;   // half the width of a path, in pixels

  // --- a small priority queue for route finding -------------------------------
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  };
  Heap.prototype.pop = function () {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) {
      let i = 0;
      for (;;) { let c = i * 2 + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  };

  HS.World = function (width, height, sprites) {
    const W = this.W = Math.ceil(width / CS), H = this.H = Math.ceil(height / CS), N = W * H;
    this.width = width; this.height = height;
    this.village = new Float32Array(N);
    this.plaza = new Float32Array(N);  this.plazaT = new Float32Array(N);
    this.path = new Float32Array(N);   this.pathT = new Float32Array(N);
    this.delay = new Float32Array(N);
    this.blocked = new Uint8Array(N);
    this.objAt = new Int32Array(N).fill(-1);
    this.wobble = new Float32Array(N);
    this.objects = [];
    this.houses = [];
    this.lanterns = new Map();
    this.clusters = [];
    // "Districts": big solid blocks of icons, which get lanes and lawns instead of one huge plaza.
    this.dist = new Float32Array(N);   this.distT = new Float32Array(N);   // how much each cell is district
    this.lane = new Uint8Array(N);     // 1 where a district lane runs (where villagers walk)
    this.props = new Map();            // houses in empty slots, small things in the gaps between icons
    this.grid = { ox: 0, oy: 0, cw: HS.ICON_W, ch: HS.ICON_H };   // the icon grid, for drawing lanes
    this.spots = [];                   // places a villager can go and stand
    this.sprites = sprites;
    this.dirty = true;
    this.version = 0;

    const rand = HS.rng(W * 1000 + H);
    const occ = new Uint8Array(N);
    const idx = (x, y) => y * W + x;
    const maxRow = Math.floor((height - HS.TASKBAR - 6) / CS);

    // Where the village is: a noisy blob in the middle of the screen, forest around it.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ex = (x + 0.5 - W * 0.5) / (W * 0.36), ey = (y + 0.5 - H * 0.5) / (H * 0.40);
      const e = 1 - Math.hypot(ex, ey) + (HS.noise(x / 9 + 40, y / 9 + 11) - 0.5) * 0.55;
      this.village[idx(x, y)] = HS.clamp(0.5 + e * 2.5, 0, 1);
      this.wobble[idx(x, y)] = HS.noise(x / 3.1 + 3, y / 3.1 + 8);
    }

    const add = (o) => {
      o.target = 1; o.scale = 1; o.delay = 0; o.phase = rand() * 6.28; o.id = this.objects.length;
      for (const c of o.cells) { occ[c] = 1; this.objAt[c] = o.id; }
      this.objects.push(o);
      return o;
    };

    // Houses, on a loose staggered grid so there are alleys between them.
    let row = 0;
    for (let gy = 2; gy + 2 < maxRow; gy += 4, row++) {
      for (let gx = 1 + (row % 2) * 2; gx + 5 < W; gx += 5) {
        const cells = rand() < 0.4 ? 4 : 3;
        const cx = gx + Math.floor(rand() * 2), cy = gy + Math.floor(rand() * 2);
        if (cx + cells >= W || cy + 2 >= maxRow) continue;
        if (this.village[idx(cx + (cells >> 1), cy + 1)] < 0.62 || rand() > 0.85) continue;
        const pool = sprites.house.filter((s) => s.cells === cells);
        const sp = pool[Math.floor(rand() * pool.length)];
        const fp = [];
        for (let y = cy; y <= cy + 1; y++) for (let x = cx; x < cx + cells; x++) fp.push(idx(x, y));
        const x = (cx + cells / 2) * CS, y = (cy + 2) * CS - 2;
        const h = add({ kind: 'house', sp, x, y, cells: fp, blocking: true,
          bbox: { x: x - sp.w / 2 + 8, y: y - sp.h + 14, w: sp.w - 16, h: sp.h - 16 },
          door: idx(Math.floor(cx + cells / 2), cy + 2), smoke: 0 });
        this.houses.push(h);
        for (let xx = cx; xx < cx + cells; xx++) occ[idx(xx, cy + 2)] = 2; // keep the doorstep clear
      }
    }

    // Trees and garden things. Dense forest outside the village, sparse greenery inside.
    const pick = (list) => list[Math.floor(rand() * list.length)];
    for (let cy = 0; cy < H; cy++) {
      for (let cx = cy % 2; cx < W; cx += 2) {
        const c = idx(cx, cy);
        if (occ[c]) continue;
        const v = this.village[c];
        let kind = null;
        if (v < 0.45) { if (rand() < 0.9) kind = rand() < 0.42 ? 'pine' : 'tree'; }
        else if (cy % 2 === 0 && rand() < 0.3) {
          const r = rand();
          kind = r < 0.4 ? 'tree' : r < 0.55 ? 'blossom' : r < 0.82 ? 'bush' : 'flowerbed';
        }
        if (!kind) continue;
        let fp = [c];
        if (kind === 'flowerbed') { if (cx + 1 >= W || occ[c + 1]) continue; fp = [c, c + 1]; }
        const sp = pick(sprites[kind]);
        const x = (cx + fp.length / 2) * CS + (rand() - 0.5) * 8, y = (cy + 1) * CS - 3 + (rand() - 0.5) * 6;
        add({ kind, sp, x, y, cells: fp, blocking: true, sway: kind === 'tree' || kind === 'blossom' || kind === 'pine',
          bbox: { x: x - sp.w / 2 + 5, y: y - sp.h + 8, w: sp.w - 10, h: sp.h - 10 } });
      }
    }
    this.objects.sort((a, b) => a.y - b.y);
    this.objects.forEach((o, i) => { o.id = i; for (const c of o.cells) this.objAt[c] = i; });
  };

  const P = HS.World.prototype;

  P.cellOf = function (px, py) {
    return HS.clamp(Math.floor(py / CS), 0, this.H - 1) * this.W + HS.clamp(Math.floor(px / CS), 0, this.W - 1);
  };
  P.cellCenter = function (c) { return { x: (c % this.W + 0.5) * CS, y: (Math.floor(c / this.W) + 0.5) * CS }; };

  // Cheapest route between two cells. cost(cell) returns how hard a cell is to cross
  // (Infinity = impossible). strict = don't squeeze diagonally between two obstacles.
  P.route = function (from, to, cost, strict) {
    const W = this.W, H = this.H, N = W * H;
    const g = this._g || (this._g = new Float32Array(N)), prev = this._prev || (this._prev = new Int32Array(N));
    g.fill(Infinity); prev.fill(-1);
    const heap = new Heap();
    const tx = to % W, ty = Math.floor(to / W);
    g[from] = 0; heap.push(0, from);
    while (heap.k.length) {
      const c = heap.pop();
      if (c === to) break;
      const x = c % W, y = Math.floor(c / W);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx, k = cost(n);
        if (k === Infinity) continue;
        if (strict && dx && dy && (cost(y * W + nx) === Infinity || cost(ny * W + x) === Infinity)) continue;
        const ng = g[c] + k * (dx && dy ? 1.414 : 1);
        if (ng < g[n]) { g[n] = ng; prev[n] = c; heap.push(ng + Math.hypot(nx - tx, ny - ty) * 0.9, n); }
      }
    }
    if (prev[to] === -1 && from !== to) return null;
    const out = [];
    for (let c = to; c !== -1; c = prev[c]) out.push(c);
    return out.reverse();
  };

  // Route for a villager on foot: around buildings and trees, preferring paths and plazas.
  P.walkRoute = function (from, to) {
    const b = this.blocked, pt = this.pathT, pl = this.plazaT, di = this.distT, ln = this.lane;
    return this.route(from, to, (c) => {
      if (b[c] && c !== from) return Infinity;
      if (di[c] > 0.5) return ln[c] ? 1 : 6;          // inside a district, stick to the lanes
      return (pt[c] > 0.5 || pl[c] > 0.5) ? 1 : 2.4;
    }, true);
  };

  // Where a villager actually puts their feet when crossing a cell. Inside a district this is
  // pulled onto the nearest lane, so they walk between the icons and not underneath them.
  P.walkPoint = function (c) {
    const p = this.cellCenter(c), g = this.grid;
    if (this.distT[c] > 0.5) {
      const lx = g.ox + Math.round((p.x - g.ox) / g.cw) * g.cw, ly = g.oy + Math.round((p.y - g.oy) / g.ch) * g.ch;
      if (Math.abs(lx - p.x) <= 13) p.x = lx;
      if (Math.abs(ly - p.y) <= 13) p.y = ly + 2;
    }
    return p;
  };

  P.allHouses = function () {
    const out = this.houses.slice();
    for (const p of this.props.values()) if (p.kind === 'house') out.push(p);
    return out;
  };

  // Look for districts: blocks of at least 12 grid-aligned icons, at least 3 wide and 3 tall.
  // Returns the icon grid, the district icons, the empty slots inside them ("lots"), and the
  // gaps between side-by-side icons where something small can stand. Null if there are none.
  P.findDistricts = function (icons) {
    if (icons.length < 12) return null;
    const cw = icons[0].w, ch = icons[0].h, mod = (v, m) => ((v % m) + m) % m;
    let ox = Infinity, oy = Infinity;
    for (const r of icons) { ox = Math.min(ox, mod(r.x, cw)); oy = Math.min(oy, mod(r.y, ch)); }
    const occ = new Map();
    for (const r of icons) {
      const fx = (r.x - ox) / cw, fy = (r.y - oy) / ch;
      if (Math.abs(fx - Math.round(fx)) * cw > 3 || Math.abs(fy - Math.round(fy)) * ch > 3) return null;  // icons are not on a grid
      occ.set(Math.round(fx) + ',' + Math.round(fy), r);
    }
    // flood-fill connected blocks of icons
    const D = new Map(), seen = new Set();
    for (const start of occ.keys()) {
      if (seen.has(start)) continue;
      const block = [], stack = [start];
      seen.add(start);
      let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
      while (stack.length) {
        const k = stack.pop(), [c, r] = k.split(',').map(Number);
        block.push(k); c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const n = (c + dc) + ',' + (r + dr);
          if (occ.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
        }
      }
      if (block.length >= 12 && c1 - c0 >= 2 && r1 - r0 >= 2) for (const k of block) D.set(k, occ.get(k));
    }
    if (!D.size) return null;

    const lots = new Map(), gaps = [];
    const bottom = this.height - HS.TASKBAR;
    for (const k of D.keys()) {
      const [c, r] = k.split(',').map(Number);
      if (D.has((c + 1) + ',' + r)) gaps.push({ c, r, x: ox + (c + 1) * cw, top: oy + r * ch });
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const ec = c + dc, er = r + dr, ek = ec + ',' + er;
        if (occ.has(ek) || lots.has(ek)) continue;
        let near = 0;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (D.has((ec + b) + ',' + (er + a))) near++;
        const x = ox + ec * cw, y = oy + er * ch;
        if (near >= 5 && x >= 0 && y >= 0 && x + cw <= this.width && y + ch <= bottom) lots.set(ek, { c: ec, r: er, x, y, w: cw, h: ch });
      }
    }
    return { ox, oy, cw, ch, rects: [...D.values()], lots: [...lots.values()], gaps };
  };

  // Rearrange the village for a new set of icon rectangles.
  // drop = where the user let go (so the change ripples outward from there), or null to apply instantly.
  P.update = function (icons, drop) {
    const W = this.W, H = this.H, N = W * H;
    const oldPlaza = this.plazaT.slice(), oldPath = this.pathT.slice();
    const plazaT = this.plazaT, pathT = this.pathT;
    const oldDist = this.distT.slice(), distT = this.distT;
    plazaT.fill(0); pathT.fill(0); distT.fill(0);

    // 0. big solid blocks of icons become districts; their empty slots count as open ground too
    const dz = this.findDistricts(icons);
    if (dz) this.grid = { ox: dz.ox, oy: dz.oy, cw: dz.cw, ch: dz.ch };
    const solid = dz ? icons.concat(dz.lots) : icons;

    // 1. open ground under and around every icon
    const reach = PLAZA_PAD + CS * 1.6;
    const stamp = (field, rects) => {
      for (const r of rects) {
        const x0 = Math.max(0, Math.floor((r.x - reach) / CS)), x1 = Math.min(W - 1, Math.floor((r.x + r.w + reach) / CS));
        const y0 = Math.max(0, Math.floor((r.y - reach) / CS)), y1 = Math.min(H - 1, Math.floor((r.y + r.h + reach) / CS));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const d = HS.rectDist((x + 0.5) * CS, (y + 0.5) * CS, r);
          const v = HS.clamp(0.5 + (PLAZA_PAD - d) / (1.6 * CS), 0, 1);
          if (v > field[y * W + x]) field[y * W + x] = v;
        }
      }
    };
    stamp(plazaT, solid);
    if (dz) stamp(distT, dz.rects.concat(dz.lots));

    // 2. anything that would stand on or in front of an icon tucks away
    const want = new Uint8Array(this.objects.length).fill(1);
    const padded = solid.map((r) => ({ x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 12 }));
    for (const o of this.objects) for (const r of padded) if (HS.rectsOverlap(o.bbox, r)) { want[o.id] = 0; break; }

    // 3. group icons that sit next to each other into clusters
    const parent = icons.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < icons.length; i++) for (let j = i + 1; j < icons.length; j++) {
      const a = icons[i], b = icons[j];
      const gx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0), gy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
      if (Math.hypot(gx, gy) < 40) parent[find(i)] = find(j);
    }
    const groups = new Map();
    icons.forEach((r, i) => { const k = find(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    this.clusters = [...groups.values()].map((rs) => {
      let best = rs[0], bd = Infinity;
      const mx = rs.reduce((s, r) => s + r.x + r.w / 2, 0) / rs.length, my = rs.reduce((s, r) => s + r.y + r.h / 2, 0) / rs.length;
      for (const r of rs) { const d = Math.hypot(r.x + r.w / 2 - mx, r.y + r.h / 2 - my); if (d < bd) { bd = d; best = r; } }
      return { x: best.x + best.w / 2, y: best.y + best.h / 2, cell: this.cellOf(best.x + best.w / 2, best.y + best.h / 2), size: rs.length };
    });

    // 4. connect the clusters with paths (shortest set of links, plus one extra so there is a loop to stroll)
    const cl = this.clusters, edges = [];
    if (cl.length > 1) {
      const inTree = [0], used = new Set();
      while (inTree.length < cl.length) {
        let best = null;
        for (const a of inTree) for (let b = 0; b < cl.length; b++) {
          if (inTree.includes(b)) continue;
          const d = Math.hypot(cl[a].x - cl[b].x, cl[a].y - cl[b].y);
          if (!best || d < best.d) best = { a, b, d };
        }
        inTree.push(best.b); edges.push(best); used.add(Math.min(best.a, best.b) + ':' + Math.max(best.a, best.b));
      }
      if (cl.length > 3) {
        let best = null;
        for (let a = 0; a < cl.length; a++) for (let b = a + 1; b < cl.length; b++) {
          if (used.has(a + ':' + b)) continue;
          const d = Math.hypot(cl[a].x - cl[b].x, cl[a].y - cl[b].y);
          if (!best || d < best.d) best = { a, b, d };
        }
        if (best) edges.push(best);
      }
    }
    const onPath = new Uint8Array(N);
    const objAt = this.objAt, objects = this.objects, village = this.village, wobble = this.wobble;
    const pathCost = (c) => {
      if (onPath[c]) return 0.3;
      if (plazaT[c] > 0.5) return 0.4;
      let k = 1 + wobble[c] * 1.6;
      const o = objAt[c];
      if (o >= 0 && want[o]) k += objects[o].kind === 'house' ? 9 : village[c] < 0.45 ? 0.5 : 1.5;
      return k;
    };
    const lanternSpots = new Map();
    for (const e of edges) {
      const cells = this.route(cl[e.a].cell, cl[e.b].cell, pathCost, false);
      if (!cells) continue;
      let since = 3;
      for (const c of cells) {
        onPath[c] = 1;
        if (plazaT[c] < 0.4 && ++since >= 7 && c % W < W - 2) {
          since = 0;
          lanternSpots.set('p' + c, { x: (c % W + 0.5) * CS + 15, y: (Math.floor(c / W) + 0.5) * CS + 2 });
        }
      }
    }
    for (let c = 0; c < N; c++) {
      if (!onPath[c]) continue;
      const x = c % W, y = Math.floor(c / W);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const v = HS.clamp(0.5 + (PATH_HALF - Math.hypot(dx, dy) * CS) / (1.4 * CS), 0, 1);
        if (v > pathT[ny * W + nx]) pathT[ny * W + nx] = v;
      }
      // whatever stands on the path makes way; trees right beside it too
      const o = objAt[c]; if (o >= 0) want[o] = 0;
      for (const n of [c - 1, c + 1]) { const t = n >= 0 && n < N ? objAt[n] : -1; if (t >= 0 && objects[t].kind !== 'house') want[t] = 0; }
    }

    // 5. apply, with the change rippling out from where the icon was dropped
    const wave = (px, py) => (drop ? Math.min(0.9, Math.hypot(px - drop.x, py - drop.y) / 900) : 0);
    for (let c = 0; c < N; c++) {
      if (!drop) { this.plaza[c] = plazaT[c]; this.path[c] = pathT[c]; this.delay[c] = 0; }
      else if (Math.abs(plazaT[c] - oldPlaza[c]) > 0.05 || Math.abs(pathT[c] - oldPath[c]) > 0.05 || Math.abs(distT[c] - oldDist[c]) > 0.05) {
        this.delay[c] = wave((c % W + 0.5) * CS, (Math.floor(c / W) + 0.5) * CS);
      }
      if (!drop) this.dist[c] = distT[c];
    }
    this.blocked.fill(0);
    for (const o of objects) {
      const t = want[o.id];
      if (!drop) { o.target = o.scale = t; o.delay = 0; }
      else if (t !== o.target) { o.target = t; o.delay = wave(o.x, o.y) + (t ? 0.55 : 0); }
      if (t && o.blocking) for (const c of o.cells) this.blocked[c] = 1;
    }

    // 6. district furnishings: a house or tree in each empty slot, and small things in the gaps
    //    between side-by-side icons (which are the only places nothing covers on a full desktop)
    const wanted = new Map(), freeGaps = [];
    if (dz) {
      const sp = this.sprites, small = sp.house.filter((s) => s.cells === 3);
      for (const lot of dz.lots) {
        const h = HS.hash2(lot.c * 3 + 11, lot.r * 5 + 7), pickN = (list) => list[Math.floor(HS.hash2(lot.c + 29, lot.r + 43) * list.length)];
        const cx = lot.x + lot.w / 2;
        if (h < 0.65) wanted.set('L' + lot.c + ',' + lot.r, { kind: 'house', sp: pickN(small), x: cx, y: lot.y + lot.h - 8 });
        else wanted.set('L' + lot.c + ',' + lot.r, { kind: 'tree', sp: pickN(h < 0.85 ? sp.tree : sp.blossom), x: cx, y: lot.y + lot.h - 16, sway: true });
      }
      for (const g of dz.gaps) {
        const h = HS.hash2(g.c * 7 + 3, g.r * 13 + 1), kind = HS.hash2(g.c + 91, g.r + 17), y = g.top + Math.min(52, dz.ch * 0.55);
        if (y > this.height - HS.TASKBAR - 4) continue;
        if (h >= 0.3) { freeGaps.push({ x: g.x, y: y - 4 }); continue; }
        if (kind < 0.35) lanternSpots.set('g' + g.c + ',' + g.r, { x: g.x, y });
        else if (kind < 0.75) wanted.set('G' + g.c + ',' + g.r, { kind: 'cypress', sp: sp.cypress[Math.floor(kind * 97) % sp.cypress.length], x: g.x, y, sway: true });
        else wanted.set('G' + g.c + ',' + g.r, { kind: 'tub', sp: sp.tub[Math.floor(kind * 97) % sp.tub.length], x: g.x, y });
      }
    }
    for (const [k, p] of this.props) if (!wanted.has(k)) p.target = 0;
    for (const [k, d] of wanted) {
      let p = this.props.get(k);
      if (!p) {
        p = Object.assign(d, { scale: drop ? 0 : 1, delay: drop ? wave(d.x, d.y) + 0.5 : 0, phase: HS.hash2(d.x | 0, d.y | 0) * 6.28, smoke: 0 });
        if (p.kind === 'house') p.door = this.cellOf(p.x, p.y + 8);
        this.props.set(k, p);
      }
      p.target = 1;
      if (p.kind === 'house') {   // villagers go around the house, not through it
        for (let yy = p.y - 30; yy <= p.y - 4; yy += CS / 2) for (let xx = p.x - 26; xx <= p.x + 26; xx += CS / 2) {
          const c = this.cellOf(xx, yy); if (c !== p.door) this.blocked[c] = 1;
        }
      }
    }

    // lanterns: along the paths, and in some district gaps
    for (const [k, l] of this.lanterns) if (!lanternSpots.has(k)) l.target = 0;
    for (const [k, pos] of lanternSpots) {
      const l = this.lanterns.get(k);
      if (l) l.target = 1;
      else this.lanterns.set(k, { x: pos.x, y: pos.y, scale: drop ? 0 : 1, target: 1, delay: drop ? 0.8 : 0 });
    }

    // district lanes run along the edges of the icon grid
    const g = this.grid;
    this.lane.fill(0);
    if (dz) for (let c = 0; c < N; c++) {
      if (distT[c] <= 0.5) continue;
      const px = (c % W + 0.5) * CS, py = (Math.floor(c / W) + 0.5) * CS;
      const dx = Math.abs(px - (g.ox + Math.round((px - g.ox) / g.cw) * g.cw)), dy = Math.abs(py - (g.oy + Math.round((py - g.oy) / g.ch) * g.ch));
      if (dx <= 13 || dy <= 13) this.lane[c] = 1;
    }

    // places a villager can go and stand: anywhere on an ordinary plaza, and in a district
    // the free gaps between icons, where they can actually be seen
    const maxRow = Math.floor((this.height - HS.TASKBAR - 6) / CS);
    this.spots = [];
    for (let c = 0; c < N; c++) {
      if (plazaT[c] > 0.6 && distT[c] < 0.5 && !this.blocked[c] && Math.floor(c / W) < maxRow) {
        const p = this.cellCenter(c); this.spots.push({ cell: c, x: p.x, y: p.y, loose: true });
      }
    }
    for (const f of freeGaps) { const c = this.cellOf(f.x, f.y); if (!this.blocked[c]) this.spots.push({ cell: c, x: f.x, y: f.y, loose: false }); }
    this.dirty = true;
    this.version++;
  };

  // Advance the animations: ground spreading, things shrinking and growing back.
  P.step = function (dt) {
    const N = this.W * this.H, k = 1 - Math.exp(-dt * 7);
    let moving = false;
    for (let c = 0; c < N; c++) {
      const dp = this.plazaT[c] - this.plaza[c], dq = this.pathT[c] - this.path[c], dd = this.distT[c] - this.dist[c];
      if (Math.abs(dp) < 0.004 && Math.abs(dq) < 0.004 && Math.abs(dd) < 0.004) continue;
      moving = true;
      if (this.delay[c] > 0) { this.delay[c] -= dt; continue; }
      this.plaza[c] += dp * k; this.path[c] += dq * k; this.dist[c] += dd * k;
    }
    for (const [key, p] of this.props) {
      if (p.scale === p.target) continue;
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.scale += (p.target - p.scale) * (1 - Math.exp(-dt * (p.target ? 5 : 12)));
      if (Math.abs(p.target - p.scale) < 0.01) { p.scale = p.target; if (!p.target) this.props.delete(key); }
    }
    if (moving) this.dirty = true;
    for (const o of this.objects) {
      if (o.scale === o.target) continue;
      if (o.delay > 0) { o.delay -= dt; continue; }
      o.scale += (o.target - o.scale) * (1 - Math.exp(-dt * (o.target ? 5 : 12)));
      if (Math.abs(o.target - o.scale) < 0.01) o.scale = o.target;
    }
    for (const [c, l] of this.lanterns) {
      if (l.delay > 0) { l.delay -= dt; continue; }
      l.scale += (l.target - l.scale) * (1 - Math.exp(-dt * 8));
      if (!l.target && l.scale < 0.02) this.lanterns.delete(c);
    }
  };
})(window.HS);
