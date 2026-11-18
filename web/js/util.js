// Shared constants and small helpers. Everything hangs off one global, HS,
// so the prototype runs from a plain file with no build step.
window.HS = {
  CS: 24,            // size of one world cell in pixels
  ICON_W: 76,        // desktop icon grid cell
  ICON_H: 88,
  ICON_MX: 8,        // margin of the icon grid from the screen edge
  ICON_MY: 8,
  TASKBAR: 44,
};

(function (HS) {
  // Small seeded random generator, so the same screen size always gives the same village.
  HS.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  HS.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  HS.lerp = (a, b, t) => a + (b - a) * t;
  HS.smooth = (a, b, v) => { const t = HS.clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // Cheap 2D value noise (0..1), used for the shape of the village and wobbly paths.
  function hash(x, y) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  HS.hash2 = hash;
  HS.noise = function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  // Distance from a point to a rectangle (0 when inside).
  HS.rectDist = function (px, py, r) {
    const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
    const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
    return Math.hypot(dx, dy);
  };

  HS.rectsOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
})(window.HS);
