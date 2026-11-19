// The land field. Every desktop icon (its whole cell: picture plus label) adds a soft Gaussian
// "hill" of open ground, and so does every path. The hills are summed, the sum is bent a little
// with noise so edges look hand-made, and everything above one level becomes a clearing.
// That outline is then turned into a signed distance (pixels to the edge, negative inside),
// which the ground shader uses for the clearing edge, its rim and its shadow alike.
//
// The field is recomputed only when the icons change. It is kept on a coarse grid (one value
// per 4x4 pixels) and handed to the graphics card as a small texture. The card keeps the
// previous field as well and morphs from old to new itself, rippling out from where an icon
// was dropped, so the processor does nothing while the ground animates.
//
// Channels of each texel:
//   0  clearing distance (px, negative inside the clearing, clamped to +-CLAMP)
//   1  distance to the nearest icon rectangle (px, 0 on an icon, clamped to ICON_CLAMP)
//   2  district distance (px, negative inside a district block)
//   3  village amount (0 = forest, 1 = middle of the village), fixed for a given screen size
(function (HS) {
  const R = 4;              // pixels per texel
  const SIGMA = 14;         // how far an icon's open ground spreads past its rectangle
  const PATH_SIGMA = 11;    // the same for paths (half width where the level is crossed ~ 13 px)
  const LEVEL = 0.5;        // the sum must reach this to count as clearing
  const CLAMP = 48, ICON_CLAMP = 96;
  const MORPH = 0.9;        // seconds each spot takes to change once the ripple reaches it
  const INF = 1e20;
  HS.FIELD_RES = R;
  HS.MORPH = MORPH;

  // How long after a drop the change reaches a given point (shared with the objects that
  // shrink and grow, so ground and scenery move together).
  HS.rippleDelay = (drop, x, y) => (drop ? Math.min(0.9, Math.hypot(x - drop.x, y - drop.y) / 900) : 0);

  // --- exact Euclidean distance transform (Felzenszwalb & Huttenlocher) --------------------
  function edt1d(f, n, d, v, z) {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const t = q - v[k]; d[q] = t * t + f[v[k]]; }
  }
  // grid: 0 at feature texels, INF elsewhere. Overwritten with squared distances in texels.
  function edt(grid, w, h, tmp) {
    const m = Math.max(w, h);
    const f = tmp.f || (tmp.f = new Float64Array(m)), d = tmp.d || (tmp.d = new Float64Array(m));
    const v = tmp.v || (tmp.v = new Int32Array(m)), z = tmp.z || (tmp.z = new Float64Array(m + 1));
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
      edt1d(f, h, d, v, z);
      for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) f[x] = grid[o + x];
      edt1d(f, w, d, v, z);
      for (let x = 0; x < w; x++) grid[o + x] = d[x];
    }
  }

  HS.Field = function (width, height) {
    const w = this.w = Math.ceil(width / R) + 1, h = this.h = Math.ceil(height / R) + 1, n = w * h;
    this.width = width; this.height = height; this.res = R;
    this.old = new Float32Array(n * 4);
    this.next = new Float32Array(n * 4);
    this.sum = new Float32Array(n);
    this.a = new Float64Array(n); this.b = new Float64Array(n); this.tmp = {};
    this.drop = null;
    this.t = 1e9;            // seconds since the last change
    this.version = 0;
    // Fixed noise that bends every outline, so clearings never look like blurred rectangles.
    this.wx = new Float32Array(n); this.wy = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = (x + 0.5) * R, py = (y + 0.5) * R, i = y * w + x;
      this.wx[i] = (HS.noise(px / 46 + 7.3, py / 46 + 1.1) - 0.5) * 18 + (HS.noise(px / 15 + 2.2, py / 15 + 9.4) - 0.5) * 6;
      this.wy[i] = (HS.noise(px / 46 + 3.9, py / 46 + 5.7) - 0.5) * 18 + (HS.noise(px / 15 + 6.1, py / 15 + 4.8) - 0.5) * 6;
    }
    for (let i = 0; i < n; i++) { this.next[i * 4] = CLAMP; this.next[i * 4 + 1] = ICON_CLAMP; this.next[i * 4 + 2] = CLAMP; }
    this.old.set(this.next);
  };
  const P = HS.Field.prototype;

  P.setVillage = function (fn) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = (y * this.w + x) * 4, v = fn((x + 0.5) * R, (y + 0.5) * R);
      this.old[i + 3] = v; this.next[i + 3] = v;
    }
  };

  // Morph progress (0..1) of the texel at (x, y) right now; matches the shader.
  P.progress = function (px, py) {
    const t = HS.clamp((this.t - HS.rippleDelay(this.drop, px, py)) / MORPH, 0, 1);
    return t * t * (3 - 2 * t);
  };
  Object.defineProperty(P, 'morphing', { get() { return this.t < MORPH + 0.95; } });

  // Add Gaussian hills for rectangles to the running sum.
  function addRects(F, rects, field, sigma) {
    const { w, h, wx, wy } = field, reach = sigma * 3.2, k = -1 / (2 * sigma * sigma);
    for (const r of rects) {
      const x0 = Math.max(0, Math.floor((r.x - reach) / R)), x1 = Math.min(w - 1, Math.ceil((r.x + r.w + reach) / R));
      const y0 = Math.max(0, Math.floor((r.y - reach) / R)), y1 = Math.min(h - 1, Math.ceil((r.y + r.h + reach) / R));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * w + x, px = (x + 0.5) * R + wx[i], py = (y + 0.5) * R + wy[i];
        const dx = Math.max(r.x - px, 0, px - r.x - r.w), dy = Math.max(r.y - py, 0, py - r.y - r.h);
        F[i] += Math.exp((dx * dx + dy * dy) * k);
      }
    }
  }
  // Paths: the strongest of the segment hills (not the sum, so joints do not bulge).
  function addPaths(F, lines, field) {
    const { w, h, wx, wy } = field, reach = PATH_SIGMA * 3.2, k = -1 / (2 * PATH_SIGMA * PATH_SIGMA);
    const best = field.b; best.fill(0);
    for (const pts of lines) for (let s = 0; s + 1 < pts.length; s++) {
      const ax = pts[s].x, ay = pts[s].y, bx = pts[s + 1].x, by = pts[s + 1].y, ex = bx - ax, ey = by - ay, ll = ex * ex + ey * ey || 1;
      const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / R)), x1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + reach) / R));
      const y0 = Math.max(0, Math.floor((Math.min(ay, by) - reach) / R)), y1 = Math.min(h - 1, Math.ceil((Math.max(ay, by) + reach) / R));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * w + x, px = (x + 0.5) * R + wx[i] * 0.6, py = (y + 0.5) * R + wy[i] * 0.6;
        const t = HS.clamp(((px - ax) * ex + (py - ay) * ey) / ll, 0, 1), dx = px - ax - ex * t, dy = py - ay - ey * t;
        const v = Math.exp((dx * dx + dy * dy) * k);
        if (v > best[i]) best[i] = v;
      }
    }
    for (let i = 0; i < F.length; i++) F[i] += best[i];
  }

  // Signed distance (px) to the LEVEL outline of F, written into channel ch of out.
  P.signed = function (F, out, ch) {
    const { w, h, a, b, tmp } = this, n = w * h;
    for (let i = 0; i < n; i++) { const inside = F[i] >= LEVEL; a[i] = inside ? 0 : INF; b[i] = inside ? INF : 0; }
    edt(a, w, h, tmp); edt(b, w, h, tmp);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, inside = F[i] >= LEVEL;
      let s = inside ? -(Math.sqrt(b[i]) - 0.5) : Math.sqrt(a[i]) - 0.5;
      // close to the outline, the slope of the field gives a smoother, sub-texel answer
      if (s > -1.6 && s < 1.6 && x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        const gx = (F[i + 1] - F[i - 1]) * 0.5, gy = (F[i + w] - F[i - w]) * 0.5, g = Math.hypot(gx, gy);
        if (g > 1e-4) s = HS.clamp((LEVEL - F[i]) / g, -1.6, 1.6);
      }
      out[i * 4 + ch] = HS.clamp(s * R, -CLAMP, CLAMP);
    }
  };

  // Build a new field. icons: icon rectangles; open: extra open rectangles (empty district
  // slots); paths: polylines [{x, y}, ...]; district: rectangles of district blocks (or null).
  // drop: where the user let go, or null to change instantly.
  P.update = function (icons, open, paths, district, drop) {
    const { w, h } = this, n = w * h, next = this.next, old = this.old;
    // whatever is on screen right now becomes the starting point of the new morph
    if (drop && this.morphing) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = this.progress((x + 0.5) * R, (y + 0.5) * R), i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) old[i + c] += (next[i + c] - old[i + c]) * p;
      }
    } else old.set(next);

    const F = this.sum;
    // 0: clearing = icons + open slots + paths
    F.fill(0);
    addRects(F, icons, this, SIGMA);
    addRects(F, open, this, SIGMA);
    addPaths(F, paths, this);
    this.signed(F, next, 0);
    // 1: distance to the nearest icon (unbent, so detail keeps a steady distance from icons)
    const a = this.a;
    a.fill(INF);
    for (const r of icons) {
      const x0 = Math.max(0, Math.ceil(r.x / R - 0.5)), x1 = Math.min(w - 1, Math.floor((r.x + r.w) / R - 0.5));
      const y0 = Math.max(0, Math.ceil(r.y / R - 0.5)), y1 = Math.min(h - 1, Math.floor((r.y + r.h) / R - 0.5));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) a[y * w + x] = 0;
    }
    edt(a, w, h, this.tmp);
    for (let i = 0; i < n; i++) next[i * 4 + 1] = Math.min(ICON_CLAMP, Math.sqrt(a[i]) * R);
    // 2: districts
    if (district && district.length) { F.fill(0); addRects(F, district, this, SIGMA); this.signed(F, next, 2); }
    else for (let i = 0; i < n; i++) next[i * 4 + 2] = CLAMP;

    this.drop = drop;
    this.t = drop ? 0 : 1e9;
    if (!drop) old.set(next);
    this.version++;
  };

  P.step = function (dt) { if (this.t < 1e8) this.t += dt; };

  // Value of channel ch of the new field at a pixel (nearest texel).
  P.at = function (px, py, ch) {
    const x = HS.clamp(Math.floor(px / R), 0, this.w - 1), y = HS.clamp(Math.floor(py / R), 0, this.h - 1);
    return this.next[(y * this.w + x) * 4 + ch];
  };
})(window.HS);
