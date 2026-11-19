// The still layer of the code-art world: everything that only changes when the icons move (or the
// colours of the hour shift). It is written into the renderer's "still" lists and uploaded once.
//
//   - fronds: small branching plants of glowing line, thick in the wild places at the screen's
//     edges, sparse in the open middle, swaying a little in the shader;
//   - grass: short strokes in clumps;
//   - stars: text characters (. · + * °) scattered through the void, each twinkling at its own pace,
//     and a few big star glints made of crossing lines;
//   - paths: dotted traces along the routes between icon groups;
//   - beacons: small ringed nodes along the paths and in district gaps;
//   - specimens: a slowly turning line flower in each empty district slot.
// Nothing goes inside a clearing, and detail fades to nothing within about 25 px of any icon.
(function (HS) {
  HS.buildFlora = function (world, r) {
    const P = HS.pal, L = r.still, G = r.stillGlyphs, f = world.field, H = HS.hash2;
    L.reset(); G.reset();
    const bottom = world.height - HS.TASKBAR - 4;
    const quiet = (x, y) => HS.smooth(6, 30, f.at(x, y, 1));
    const open = (x, y, m) => f.at(x, y, 0) > m;

    // fronds: a recursive fan of segments, each level shorter, swaying more toward the tips
    function frond(x, y, size, seed, a) {
      const rnd = HS.rng(seed), segs = [];
      const grow = (px, py, ang, len, depth, h) => {
        const nx = px + Math.cos(ang) * len, ny = py + Math.sin(ang) * len, h2 = h + len;
        segs.push([px, py, nx, ny, h, h2, depth]);
        if (depth <= 0) return;
        const n = depth > 2 ? 2 : 2 + (rnd() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) grow(nx, ny, ang + (i - (n - 1) / 2) * (0.5 + rnd() * 0.35) + (rnd() - 0.5) * 0.3, len * (0.62 + rnd() * 0.12), depth - 1, h2);
      };
      grow(x, y, -Math.PI / 2 + (rnd() - 0.5) * 0.5, size, 3, 0);
      const total = size * 2.6, phase = x * 0.012 + y * 0.006;
      for (const [ax, ay, bx, by, ha, hb, depth] of segs) {
        const t = hb / total, col = HS.mixc(P.flora, P.line, Math.min(1, t * 0.35));
        L.add(ax, ay, bx, by, depth > 1 ? 0.6 : 0.45, 1.5, col, a * (0.5 + 0.5 * t), ha / total * 2.4, hb / total * 2.4, phase, 0);
        if (depth === 0 && rnd() < 0.35) L.dot(bx, by, 0.8, 2, P.joint, a * 0.5, 0.4, rnd() * 6);
      }
    }
    function grass(x, y, seed, a) {
      const rnd = HS.rng(seed), n = 3 + Math.floor(rnd() * 3), phase = x * 0.012 + y * 0.006;
      for (let i = 0; i < n; i++) {
        const bx = x + (rnd() - 0.5) * 8, len = 5 + rnd() * 7, lean = (rnd() - 0.5) * 6;
        L.add(bx, y, bx + lean, y - len, 0.45, 1.6, P.flora, a, 0, 1.2, phase, 0);
      }
    }

    // a jittered grid over the whole picture decides where plants go
    const STEP = 26;
    for (let gy = 0; gy * STEP < bottom; gy++) for (let gx = 0; gx * STEP < world.width; gx++) {
      const h1 = H(gx * 7 + 1, gy * 13 + 5), h2 = H(gx * 11 + 3, gy * 5 + 9), h3 = H(gx + 71, gy + 37);
      const x = (gx + 0.15 + h1 * 0.7) * STEP, y = (gy + 0.15 + h2 * 0.7) * STEP;
      if (!open(x, y, 10)) continue;
      const q = quiet(x, y);
      if (q < 0.15) continue;
      const wild = 1 - world.village[world.cellOf(x, y)];       // 1 at the screen edges, 0 in the middle
      const patch = HS.noise(x / 160 + 5, y / 160 + 2);
      if (h3 < 0.03 + wild * 0.22 * patch && open(x, y - 30, 8)) frond(x, y, 9 + h1 * 9 + wild * 6, gx * 1000 + gy, 0.4 * q);
      else if (h3 > 0.9 - patch * 0.15) grass(x, y, gx * 7919 + gy, 0.35 * q);
    }

    // stars and dust: text characters scattered through the void
    const stars = '..··++*°';
    for (let i = 0; i < 900; i++) {
      const x = H(i, 3) * world.width, y = H(i, 7) * bottom;
      if (!open(x, y, 4)) continue;
      const q = quiet(x, y);
      if (q < 0.3) continue;
      const k = H(i, 11), ch = stars[Math.floor(k * stars.length)], big = ch === '*' || ch === '+';
      const col = HS.mixc(P.star, k > 0.85 ? P.accent : P.line, k > 0.85 ? 0.5 : 0.15);
      G.add(ch, x, y, big ? 9 + H(i, 13) * 4 : 8, col, (0.22 + H(i, 17) * 0.4) * q, 0.3 + H(i, 19) * 0.7, H(i, 23));
    }
    // a few big glints: crossing lines with a bright centre
    for (let i = 0; i < 9; i++) {
      const x = H(i, 101) * world.width, y = H(i, 103) * bottom;
      if (!open(x, y, 30) || quiet(x, y) < 0.95) continue;
      const s = 10 + H(i, 107) * 16, ph = H(i, 109) * 6;
      L.add(x - s, y, x + s, y, 0.45, 2.5, P.star, 0.5, 0, 0, ph, 0.6);
      L.add(x, y - s * 1.3, x, y + s * 1.3, 0.45, 2.5, P.star, 0.5, 0, 0, ph, 0.6);
      L.add(x - s * 0.35, y - s * 0.35, x + s * 0.35, y + s * 0.35, 0.4, 2, P.star, 0.35, 0, 0, ph, 0.6);
      L.add(x - s * 0.35, y + s * 0.35, x + s * 0.35, y - s * 0.35, 0.4, 2, P.star, 0.35, 0, 0, ph, 0.6);
      L.dot(x, y, 1.6, 4, P.star, 0.9, 0.6, ph);
    }

    // paths: a dotted trace down the middle of each route
    for (const pts of world.lines || []) {
      let acc = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
        for (; acc < len; acc += 9) {
          const t = acc / len, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
          if (f.at(x, y, 1) > 18) L.dot(x, y, 0.7, 1.8, P.contour, 0.55);
        }
        acc -= len;
      }
    }
    // beacons along the paths and in district gaps
    for (const l of world.lanterns.values()) {
      if (l.target !== 1 || f.at(l.x, l.y, 1) < 14) continue;
      L.circle(l.x, l.y, 5, 0.45, 1.8, P.accent, 0.55, 14);
      L.dot(l.x, l.y, 1.4, 4, P.accent, 0.9, 0.5, l.x * 0.1);
    }
    // specimens: a line flower in each empty district slot
    for (const lot of world.lots || []) {
      const cx = lot.x + lot.w / 2, cy = lot.y + lot.h / 2, n = 6 + Math.floor(H(lot.c, lot.r) * 5), rr = Math.min(lot.w, lot.h) * 0.28;
      for (let i = 0; i < n; i++) {
        const a = i / n * 6.2832 + H(lot.r, lot.c) * 3, mx = cx + Math.cos(a + 0.35) * rr * 0.6, my = cy + Math.sin(a + 0.35) * rr * 0.6;
        const ex = cx + Math.cos(a) * rr, ey = cy + Math.sin(a) * rr;
        L.add(cx, cy, mx, my, 0.5, 2, P.line, 0.5); L.add(mx, my, ex, ey, 0.5, 2, P.line2, 0.5);
        L.dot(ex, ey, 1.1, 3, P.joint, 0.7, 0.5, a);
      }
      L.circle(cx, cy, 3, 0.5, 2, P.accent, 0.8, 10);
    }
    r.stillDirty = true;
  };
})(window.HS);
