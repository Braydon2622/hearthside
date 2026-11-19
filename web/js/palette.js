// The colours of the code-art world, by time of day. The background always stays close to black;
// what changes is the light the linework gives off: soft mint and sky by day, ember orange and red
// at sunset, violet at dusk, cool cyan and magenta at night.
//
// Roles:
//   bg      the void
//   line    creature bodies and legs (start of a leg)
//   line2   the far end of legs and tentacles (legs fade from line to line2)
//   joint   bright dots at joints and feet
//   contour the outline of the ground around the icons
//   flora   the dim plant linework in the void
//   star    text-character stars and dust
//   accent  rare highlights (path packets, beacons, the cursor ring)
(function (HS) {
  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const ROLES = ['bg', 'line', 'line2', 'joint', 'contour', 'flora', 'star', 'accent'];
  const K = (hour, bg, line, line2, joint, contour, flora, star, accent, bloom) =>
    ({ hour, c: [bg, line, line2, joint, contour, flora, star, accent].map(hex), bloom });
  const KEYS = [
    K(0,    '#03040a', '#6fe3ff', '#9b7bff', '#ff7ad9', '#3fb4d8', '#1d4a63', '#b9c6ff', '#ff7ad9', 1.0),
    K(4.8,  '#03040a', '#6fe3ff', '#9b7bff', '#ff7ad9', '#3fb4d8', '#1d4a63', '#b9c6ff', '#ff7ad9', 1.0),
    K(6.3,  '#0a060d', '#ffb08a', '#ff6f91', '#ffe0a3', '#ff9e7a', '#5a3a58', '#ffd9c7', '#ffe0a3', 0.9),
    K(8.5,  '#05080b', '#8ff0cf', '#7fc8ff', '#fff2a6', '#7fe0c4', '#245a4c', '#d6f5ea', '#fff2a6', 0.75),
    K(16.5, '#05080b', '#8ff0cf', '#7fc8ff', '#fff2a6', '#7fe0c4', '#245a4c', '#d6f5ea', '#fff2a6', 0.75),
    K(18.6, '#0a0503', '#ff7a2e', '#ff2e4d', '#ffd36b', '#ff8a4a', '#5e2516', '#ffd2b0', '#ffd36b', 1.0),
    K(20.2, '#06040c', '#c77dff', '#5f8bff', '#ff8ad8', '#a98bff', '#3a2a6b', '#d9ccff', '#ff8ad8', 1.0),
    K(21.6, '#03040a', '#6fe3ff', '#9b7bff', '#ff7ad9', '#3fb4d8', '#1d4a63', '#b9c6ff', '#ff7ad9', 1.0),
    K(24,   '#03040a', '#6fe3ff', '#9b7bff', '#ff7ad9', '#3fb4d8', '#1d4a63', '#b9c6ff', '#ff7ad9', 1.0),
  ];

  // HS.pal.line etc. are [r, g, b] in 0..1; HS.pal.key changes only when the colours visibly change.
  HS.pal = { bloom: 1, key: '' };
  HS.setHour = function (h) {
    let a = KEYS[0], b = KEYS[1];
    for (let i = 1; i < KEYS.length; i++) if (h <= KEYS[i].hour) { a = KEYS[i - 1]; b = KEYS[i]; break; }
    const t = HS.clamp((h - a.hour) / Math.max(0.001, b.hour - a.hour), 0, 1), s = t * t * (3 - 2 * t);
    ROLES.forEach((r, i) => { HS.pal[r] = a.c[i].map((v, j) => v + (b.c[i][j] - v) * s); });
    HS.pal.bloom = a.bloom + (b.bloom - a.bloom) * s;
    // the ground is repainted when its colours move by a visible step (about every few minutes at dusk)
    HS.pal.key = HS.pal.contour.concat(HS.pal.bg, HS.pal.flora).map((v) => Math.round(v * 48)).join(',');
  };
  HS.mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  HS.setHour(12);
})(window.HS);
