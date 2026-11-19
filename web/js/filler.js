// Small things drawn by code, in large numbers: bushes, little tree crowns, dabs of flowers, grass
// tufts, fences round some gardens, rows of crops and stepping stones up to the doors. They are what
// makes the village feel rich without adding more houses.
//
// A handful of shape templates are painted once (in the shared palette, lit from the top-left) and
// packed into the sprite sheet with everything else. Where each piece goes is worked out only when
// the icons change, from the land field: nothing inside a clearing, quieter detail close to icons
// (fading to nothing within about 20 px), and denser decoration along the edges of clearings.
// The pieces live in their own buffer on the graphics card, uploaded only when they change; growing
// in and shrinking away is animated by the card, so they cost almost nothing per frame.
(function (HS) {
  const S = 2;   // drawn at double size, like the other sprites
  // the shared palette written by tools/cut-sprites.ps1 (web/art/palette.json); these are its colours
  const C = {
    deep: '#254b33', green: '#507338', leaf: '#7a9447', light: '#98b44c', lime: '#c1d25d',
    bark: '#542920', wood: '#6a4435', plank: '#8e563e', tan: '#ba6f4b',
    stoneDk: '#8a7462', stone: '#b9a895', stoneLt: '#e4c7ad', slate: '#43566a',
    red: '#d3403a', pink: '#dc76a2', yellow: '#f9d254', cream: '#f2e3c6', blue: '#88abb6', orange: '#ea9537',
    soil: '#6a4435', soilDk: '#542920',
  };

  function make(w, h, ax, ay, paint) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * S); c.height = Math.ceil(h * S);
    const g = c.getContext('2d');
    g.scale(S, S); g.lineCap = 'round'; g.lineJoin = 'round';
    paint(g, HS.rng(Math.round(w * 131 + h * 17 + ax * 7)));
    return { canvas: c, w, h, ax, ay };
  }
  const dab = (g, x, y, r, col, a) => { g.globalAlpha = a == null ? 1 : a; g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.globalAlpha = 1; };

  // A leafy mass from overlapping dabs: dark base, mid tones, sunlit dabs to the upper left,
  // shade to the lower right, and a darker painted edge.
  function foliage(g, rand, cx, cy, r, n, base, mid, lit, edge) {
    const blobs = [];
    for (let i = 0; i < n; i++) {
      const a = rand() * 6.28, d = rand() * r * 0.55;
      blobs.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, r * (0.42 + rand() * 0.22)]);
    }
    for (const [x, y, br] of blobs) dab(g, x + 0.8, y + 0.8, br + 0.9, edge, 0.85);
    for (const [x, y, br] of blobs) dab(g, x, y, br, base);
    for (const [x, y, br] of blobs) dab(g, x - br * 0.18, y - br * 0.2, br * 0.72, mid);
    for (const [x, y, br] of blobs) if (rand() < 0.8) dab(g, x - br * 0.38, y - br * 0.4, br * 0.36, lit, 0.9);
  }

  HS.buildFillerSprites = function () {
    const f = {};
    f.bush = [
      make(30, 26, 15, 22, (g, r) => foliage(g, r, 15, 13, 11, 6, C.green, C.leaf, C.light, C.deep)),
      make(26, 22, 13, 19, (g, r) => foliage(g, r, 13, 11, 9, 5, C.deep, C.green, C.leaf, '#1d3526')),
      make(30, 26, 15, 22, (g, r) => { foliage(g, r, 15, 13, 11, 6, C.green, C.leaf, C.lime, C.deep); for (let i = 0; i < 6; i++) dab(g, 7 + r() * 16, 6 + r() * 12, 1.4, i % 2 ? C.pink : C.cream); }),
      make(24, 20, 12, 17, (g, r) => foliage(g, r, 12, 10, 8, 5, C.leaf, C.light, C.lime, C.green)),
    ];
    f.crown = [
      make(44, 42, 22, 38, (g, r) => { dab(g, 22, 36, 2.4, C.bark); foliage(g, r, 22, 19, 17, 8, C.deep, C.green, C.leaf, '#1d3526'); }),
      make(40, 38, 20, 34, (g, r) => { dab(g, 20, 32, 2.2, C.bark); foliage(g, r, 20, 17, 15, 7, C.green, C.leaf, C.lime, C.deep); }),
      make(42, 40, 21, 36, (g, r) => { dab(g, 21, 34, 2.2, C.bark); foliage(g, r, 21, 18, 16, 8, '#2f5a3c', C.green, C.light, '#1d3526'); }),
    ];
    f.flowers = [C.red, C.pink, C.yellow, C.cream, C.blue, C.orange].map((col) => make(14, 12, 7, 10, (g, r) => {
      for (let i = 0; i < 3; i++) dab(g, 3 + r() * 8, 4 + r() * 6, 1.6, C.green);
      for (let i = 0; i < 6; i++) { const x = 2.5 + r() * 9, y = 2.5 + r() * 7; dab(g, x + 0.4, y + 0.4, 1.5, C.deep, 0.5); dab(g, x, y, 1.35, col); }
    }));
    f.tuft = [0, 1, 2].map(() => make(12, 10, 6, 9, (g, r) => {
      g.lineWidth = 1.1;
      for (let i = 0; i < 5; i++) {
        const x = 2 + r() * 8; g.strokeStyle = i % 2 ? C.deep : C.green;
        g.beginPath(); g.moveTo(x, 9); g.quadraticCurveTo(x + (r() - 0.5) * 3, 5, x + (r() - 0.5) * 5, 1 + r() * 3); g.stroke();
      }
    }));
    f.stone = [0, 1, 2].map((i) => make(13, 9, 6.5, 7, (g, r) => {
      g.fillStyle = C.stoneDk; g.beginPath(); g.ellipse(7, 5, 5.6, 3.6, r() - 0.5, 0, 7); g.fill();
      g.fillStyle = i === 2 ? C.stoneLt : C.stone; g.beginPath(); g.ellipse(6.6, 4.5, 4.8, 3.0, r() - 0.5, 0, 7); g.fill();
      dab(g, 5, 3.4, 1.4, C.stoneLt, 0.8);
    }));
    f.fenceH = make(26, 12, 13, 10, (g) => {
      g.strokeStyle = C.wood; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(1, 5); g.lineTo(25, 5); g.moveTo(1, 8); g.lineTo(25, 8); g.stroke();
      g.strokeStyle = C.tan; g.lineWidth = 0.8; g.beginPath(); g.moveTo(1, 4.4); g.lineTo(25, 4.4); g.stroke();
      for (const x of [2, 13, 24]) { g.fillStyle = C.bark; g.fillRect(x - 1.4, 2, 2.8, 8.5); g.fillStyle = C.plank; g.fillRect(x - 1.4, 2, 2.8, 2.2); }
    });
    f.fenceV = make(8, 28, 4, 26, (g) => {
      g.strokeStyle = C.wood; g.lineWidth = 1.6; g.beginPath(); g.moveTo(4, 2); g.lineTo(4, 26); g.stroke();
      g.strokeStyle = C.tan; g.lineWidth = 0.7; g.beginPath(); g.moveTo(3.3, 2); g.lineTo(3.3, 26); g.stroke();
      for (const y of [3, 14, 25]) { g.fillStyle = C.bark; g.fillRect(2.4, y - 2, 3.2, 3.6); g.fillStyle = C.plank; g.fillRect(2.4, y - 2, 3.2, 1.4); }
    });
    f.crops = [[C.leaf, C.light], [C.green, C.orange], [C.leaf, C.red]].map(([leaf, fruit], k) => make(50, 38, 25, 35, (g, r) => {
      g.fillStyle = C.soilDk; g.beginPath(); g.roundRect(2, 3, 46, 32, 5); g.fill();
      g.fillStyle = C.soil; g.beginPath(); g.roundRect(1.5, 2, 46, 31, 5); g.fill();
      for (let row = 0; row < 4; row++) {
        const y = 7 + row * 7.5;
        g.strokeStyle = C.soilDk; g.lineWidth = 1.2; g.beginPath(); g.moveTo(5, y + 2.8); g.lineTo(45, y + 2.8); g.stroke();
        for (let x = 6; x < 45; x += 4.6) {
          dab(g, x + 0.5, y + 0.6, 2.1, C.deep, 0.7); dab(g, x, y, 2.0, leaf); dab(g, x - 0.6, y - 0.7, 0.9, C.lime, 0.8);
          if (k && r() < 0.35) dab(g, x + 1, y + 1.2, 1.3, fruit);
        }
      }
    }));
    return f;
  };

  // What makes the filler for a world. pieces: key -> piece, so a piece that is still wanted after
  // the icons move keeps its place instead of popping.
  HS.Filler = function (world, sprites) {
    this.world = world; this.f = sprites.filler; this.pieces = new Map();
    this.dirty = true; this.cleanAt = Infinity;
  };
  const P = HS.Filler.prototype;

  P.wanted = function () {
    const w = this.world, field = w.field, f = this.f, out = new Map(), H = HS.hash2;
    const bottom = w.height - HS.TASKBAR - 4;
    const free = (x, y) => {   // not under a standing house or tree trunk
      const o = w.objAt[w.cellOf(x, y)];
      return o < 0 || w.objects[o].target === 0 || w.objects[o].kind === 'flowerbed';
    };
    const quiet = (x, y) => HS.smooth(4, 24, field.at(x, y, 1));   // 0 on and right next to icons
    const put = (key, sp, x, y, scale, cast, sway) => out.set(key, { sp, x, y, scale, cast, sway });

    // a jittered 14 px grid over the whole picture
    const STEP = 14;
    for (let gy = 0; gy * STEP < bottom; gy++) for (let gx = 0; gx * STEP < w.width; gx++) {
      const h1 = H(gx * 7 + 1, gy * 13 + 5), h2 = H(gx * 11 + 3, gy * 5 + 9), h3 = H(gx + 71, gy + 37);
      const x = (gx + 0.15 + h1 * 0.7) * STEP, y = (gy + 0.15 + h2 * 0.7) * STEP;
      const sdf = field.at(x, y, 0);
      if (sdf < 3 || y > bottom) continue;
      const q = quiet(x, y);
      if (q < 0.12) continue;
      if (!free(x, y)) continue;
      const v = w.village[w.cellOf(x, y)];
      const meadow = HS.noise(x / 95 + 3, y / 95 + 7), shrubs = HS.noise(x / 150 + 11, y / 150 + 2), key = gx + ',' + gy;
      const s = (0.7 + h3 * 0.45) * (0.45 + q * 0.55);
      if (sdf < 18) {                                     // the rim of a clearing: dense, small things
        if (h3 < 0.32) put(key, f.bush[Math.floor(h1 * 4)], x, y, s * 0.85, 5, 0.5);
        else if (h3 < 0.62) put(key, f.flowers[Math.floor(h2 * 6)], x, y, s, 1, 0);
        else if (h3 < 0.8) put(key, f.tuft[Math.floor(h1 * 3)], x, y, s, 0, 0);
      } else if (v < 0.45) {                               // forest floor, between the big trees
        if (h3 < 0.16) put(key, f.crown[Math.floor(h1 * 3)], x, y, s, 11, 1.4);
        else if (h3 < 0.34) put(key, f.bush[Math.floor(h1 * 4)], x, y, s, 5, 0.5);
        else if (h3 < 0.45) put(key, f.tuft[Math.floor(h1 * 3)], x, y, s, 0, 0);
      } else {                                            // village grass
        // flowers grow in drifts of one or two colours, not sprinkled everywhere
        if (meadow > 0.64 && h3 < 0.5) put(key, f.flowers[Math.floor((meadow * 13 + h1 * 1.5) % 6)], x, y, s, 1, 0);
        else if (shrubs > 0.64 && h3 < 0.4) put(key, f.bush[Math.floor(h1 * 4)], x, y, s, 5, 0.5);
        else if (h3 < 0.06) put(key, f.crown[Math.floor(h1 * 3)], x, y, s, 11, 1.4);
        else if (h3 < 0.24) put(key, f.tuft[Math.floor(h1 * 3)], x, y, s, 0, 0);
        else if (h3 > 0.985) put(key, f.flowers[Math.floor(h2 * 6)], x, y, s, 1, 0);
      }
    }

    // small fields of crops (four beds in a square) on the outskirts of the village, where there is room
    for (let gy = 1; gy * 130 < bottom - 60; gy++) for (let gx = 1; gx * 150 < w.width - 60; gx++) {
      const x = gx * 150 + (H(gx, gy + 300) - 0.5) * 40, y = gy * 130 + (H(gx + 300, gy) - 0.5) * 30;
      const v = w.village[w.cellOf(x, y)];
      if (v < 0.5 || v > 0.88 || HS.noise(x / 200 + 21, y / 200 + 4) < 0.5) continue;
      let ok = true;
      for (let dy = -80; dy <= 4 && ok; dy += 21) for (let dx = -56; dx <= 56; dx += 28) {
        if (field.at(x + dx, y + dy, 0) < 10 || quiet(x + dx, y + dy) < 0.9 || !free(x + dx, y + dy)) { ok = false; break; }
      }
      if (!ok) continue;
      const kind = Math.floor(H(gx + 9, gy + 9) * 3);
      for (const [k, p] of out) if (p.x > x - 58 && p.x < x + 58 && p.y > y - 78 && p.y < y + 8) out.delete(k);   // clear the ground first
      for (const [dx, dy, i] of [[-26, -40, 0], [26, -40, 1], [-26, 0, 2], [26, 0, 3]]) {
        put('c' + gx + ',' + gy + ',' + i, f.crops[(kind + (i === 3 ? 1 : 0)) % 3], x + dx, y + dy, 1, 0, 0);
      }
    }

    // round each standing house: stepping stones to the door, and a fence along some gardens
    for (const hs of w.allHouses()) {
      if (hs.target !== 1) continue;
      const id = Math.round(hs.x) + ',' + Math.round(hs.y), hh = H(Math.round(hs.x), Math.round(hs.y));
      for (let i = 0; i < 3; i++) {
        const x = hs.x + (H(i, Math.round(hs.x)) - 0.5) * 6, y = hs.y + 10 + i * 11;
        if (field.at(x, y, 0) > 2 && quiet(x, y) > 0.5 && free(x, y + 4)) put('s' + id + i, f.stone[i], x, y, 1, 0, 0);
      }
      if (hh < 0.55) {
        const half = hs.sp.w * 0.56, fy = hs.y + 12;
        for (let x = hs.x - half; x <= hs.x + half; x += 24) {
          if (Math.abs(x - hs.x) < 16) continue;   // the gate
          if (field.at(x, fy, 0) > 6 && quiet(x, fy) > 0.8) put('f' + id + x.toFixed(0), f.fenceH, x, fy, 1, 4, 0);
        }
        for (const sx of [-1, 1]) for (let y = fy - 24; y > hs.y - hs.sp.h * 0.6; y -= 24) {
          const x = hs.x + sx * (half + 1);
          if (field.at(x, y, 0) > 6 && quiet(x, y) > 0.8) put('v' + id + sx + y.toFixed(0), f.fenceV, x, y, 1, 4, 0);
        }
      }
    }
    return out;
  };

  // Work out the filler again (the icons changed). Pieces that stay keep their place; new ones grow
  // in and gone ones shrink away, both following the ripple from the drop point.
  P.update = function (drop, now) {
    const want = this.wanted(), pieces = this.pieces;
    for (const [k, p] of pieces) {
      if (want.has(k) || p.dir < 0) continue;
      p.dir = -1; p.start = now + HS.rippleDelay(drop, p.x, p.y) * (drop ? 1 : 0);
      if (!drop) pieces.delete(k);
    }
    for (const [k, n] of want) {
      const p = pieces.get(k);
      if (p && p.dir >= 0 && p.sp === n.sp) continue;
      n.dir = drop ? 1 : 0;
      n.start = now + (drop ? HS.rippleDelay(drop, n.x, n.y) + 0.35 + HS.hash2(Math.round(n.x), Math.round(n.y)) * 0.5 : 0);
      n.phase = HS.hash2(Math.round(n.y), Math.round(n.x)) * 6.28;
      pieces.set(k, n);
    }
    this.cleanAt = drop ? now + 2.6 : Infinity;
    this.dirty = true;
  };

  // Drop pieces that have finished shrinking away (once the change is over).
  P.step = function (now) {
    if (now < this.cleanAt) return;
    this.cleanAt = Infinity;
    for (const [k, p] of this.pieces) {
      if (p.dir < 0) this.pieces.delete(k);
      else if (p.dir > 0 && now > p.start + 1) p.dir = 0;
    }
    this.dirty = true;
  };

  // Write the pieces into a sprite batch (only when they changed).
  P.fill = function (batch) {
    batch.reset();
    for (const p of this.pieces.values()) {
      batch.add(p.sp, p.x, p.y, p.scale, p.scale, false, 1, 1, 1, 1, 0, p.sway, p.phase, p.cast, p.dir);
      batch.data[(batch.n - 1) * 20 + 19] = p.start;
    }
    this.dirty = false;
  };
})(window.HS);
