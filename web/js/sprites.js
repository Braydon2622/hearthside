// Placeholder art. Every building, tree and prop is drawn once into its own small
// off-screen canvas ("sprite") and then stamped onto the screen each frame.
// When real painted art exists, these canvases get swapped for image files and
// nothing else in the program has to change.
(function (HS) {
  const S = 2; // sprites are drawn at double size so they stay crisp

  function make(w, h, ax, ay, paint) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * S); c.height = Math.ceil(h * S);
    const g = c.getContext('2d');
    g.scale(S, S);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const extra = paint(g) || {};
    return Object.assign({ canvas: c, w, h, ax, ay }, extra);
  }

  function shadow(g, cx, cy, rx, ry) {
    g.fillStyle = 'rgba(30,45,30,.22)';
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
  }

  function house(w, roof, roofDark, wall, rand) {
    const wallH = 30, roofH = 28, pad = 9, top = 14;
    const cw = w + pad * 2, ch = top + roofH + wallH + 8;
    const x0 = pad, wy = top + roofH, by = wy + wallH;
    const info = { windows: [], chimney: null };
    const sprite = make(cw, ch, cw / 2, by, (g) => {
      shadow(g, cw / 2, by + 1, w / 2 + 7, 6);

      // wall
      g.fillStyle = wall; g.fillRect(x0, wy, w, wallH);
      g.fillStyle = 'rgba(90,70,50,.22)'; g.fillRect(x0, wy, w, 5);          // shade under the eave
      g.fillStyle = '#9c917f'; g.fillRect(x0, by - 5, w, 5);                  // stone footing
      g.strokeStyle = '#6b4a33'; g.lineWidth = 2;                             // timber frame
      g.strokeRect(x0 + 1, wy + 1, w - 2, wallH - 2);
      g.beginPath();
      g.moveTo(x0 + w * 0.3, wy); g.lineTo(x0 + w * 0.3, by - 5);
      g.moveTo(x0 + w * 0.7, wy); g.lineTo(x0 + w * 0.7, by - 5);
      g.stroke();

      // door
      const dw = 12, dh = 19, dx = cw / 2 - dw / 2, dy = by - dh;
      g.fillStyle = '#5a3c28';
      g.beginPath(); g.moveTo(dx, by); g.lineTo(dx, dy + 5); g.arc(dx + dw / 2, dy + 6, dw / 2, Math.PI, 0); g.lineTo(dx + dw, by); g.fill();
      g.fillStyle = '#e2b659'; g.fillRect(dx + dw - 4, by - 9, 1.6, 1.6);

      // windows
      const ww = 11, wh = 11, wyy = wy + 9;
      for (const wx of [x0 + w * 0.15 - ww / 2 + 1, x0 + w * 0.85 - ww / 2 - 1]) {
        g.fillStyle = '#4f6f82'; g.fillRect(wx, wyy, ww, wh);
        g.strokeStyle = '#6b4a33'; g.lineWidth = 1.5; g.strokeRect(wx, wyy, ww, wh);
        g.beginPath(); g.moveTo(wx + ww / 2, wyy); g.lineTo(wx + ww / 2, wyy + wh); g.moveTo(wx, wyy + wh / 2); g.lineTo(wx + ww, wyy + wh / 2); g.stroke();
        info.windows.push({ x: wx - cw / 2, y: wyy - by, w: ww, h: wh });
      }
      // flower box under the left window
      const fx = x0 + w * 0.15 - 7;
      g.fillStyle = '#7a5236'; g.fillRect(fx, wyy + wh + 1, 14, 3);
      for (let i = 0; i < 5; i++) { g.fillStyle = ['#e8697a', '#f3c64f', '#f4f0e6'][i % 3]; g.fillRect(fx + 1 + i * 2.6, wyy + wh - 1, 2, 2); }

      // roof
      const rl = x0 - 6, rr = x0 + w + 6, rt = wy - roofH, inset = 13;
      g.fillStyle = roof;
      g.beginPath(); g.moveTo(rl, wy + 2); g.lineTo(rr, wy + 2); g.lineTo(rr - inset, rt); g.lineTo(rl + inset, rt); g.closePath(); g.fill();
      g.save(); g.clip();
      g.strokeStyle = roofDark; g.lineWidth = 1; g.globalAlpha = .55;
      for (let y = rt + 6; y < wy + 2; y += 6) { g.beginPath(); g.moveTo(rl, y); g.lineTo(rr, y); g.stroke(); }
      g.globalAlpha = .35; g.fillStyle = roofDark; g.fillRect(rl, wy - 4, rr - rl, 6);
      g.globalAlpha = .28; g.fillStyle = '#fff'; g.fillRect(rl, rt, rr - rl, 3);
      g.restore();

      // chimney
      const cx = x0 + w * (rand() < 0.5 ? 0.3 : 0.7) - 4, cy = rt - 8;
      g.fillStyle = '#a89c8c'; g.fillRect(cx, cy, 8, 15);
      g.fillStyle = '#8a7f71'; g.fillRect(cx - 1, cy, 10, 3);
      info.chimney = { x: cx + 4 - cw / 2, y: cy - by };
    });
    return Object.assign(sprite, info);
  }

  function roundTree(r, cols) {
    const cw = r * 2 + 12, ch = r * 2 + 24, cx = cw / 2, by = ch - 5;
    return make(cw, ch, cx, by, (g) => {
      shadow(g, cx, by, r * 0.8, 4.5);
      g.fillStyle = '#6a4a31'; g.fillRect(cx - 2.5, by - 13, 5, 13);
      const cy = by - 10 - r * 0.85;
      g.fillStyle = cols[0]; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
      g.beginPath(); g.arc(cx - r * 0.55, cy + r * 0.35, r * 0.55, 0, 7); g.arc(cx + r * 0.55, cy + r * 0.38, r * 0.5, 0, 7); g.fill();
      g.fillStyle = cols[1]; g.beginPath(); g.arc(cx - r * 0.15, cy - r * 0.18, r * 0.76, 0, 7); g.fill();
      g.fillStyle = cols[2]; g.beginPath(); g.arc(cx - r * 0.32, cy - r * 0.4, r * 0.4, 0, 7); g.fill();
    });
  }

  function pine(hgt, cols) {
    const hw = hgt * 0.36, cw = hw * 2 + 10, ch = hgt + 14, cx = cw / 2, by = ch - 5;
    return make(cw, ch, cx, by, (g) => {
      shadow(g, cx, by, hw * 0.8, 4);
      g.fillStyle = '#5c412c'; g.fillRect(cx - 2, by - 8, 4, 8);
      for (let i = 0; i < 3; i++) {
        const y1 = by - 5 - i * hgt * 0.26, y0 = y1 - hgt * 0.46, half = hw * (1 - i * 0.24);
        g.fillStyle = cols[0]; g.beginPath(); g.moveTo(cx - half, y1); g.lineTo(cx + half, y1); g.lineTo(cx, y0); g.fill();
        g.fillStyle = cols[1]; g.beginPath(); g.moveTo(cx - half, y1); g.lineTo(cx - half * 0.1, y1); g.lineTo(cx, y0); g.fill();
      }
    });
  }

  function bush(cols) {
    return make(30, 22, 15, 19, (g) => {
      shadow(g, 15, 19, 12, 3.5);
      g.fillStyle = cols[0]; g.beginPath(); g.arc(9, 13, 7, 0, 7); g.arc(20, 13, 7.5, 0, 7); g.arc(14.5, 9.5, 7.5, 0, 7); g.fill();
      g.fillStyle = cols[2]; g.beginPath(); g.arc(12.5, 8.5, 4, 0, 7); g.fill();
    });
  }

  function flowerbed(rand) {
    return make(44, 20, 22, 17, (g) => {
      g.fillStyle = '#7b5a3c'; g.beginPath(); g.roundRect(2, 5, 40, 12, 4); g.fill();
      g.fillStyle = '#5f8f45';
      for (let i = 0; i < 9; i++) g.fillRect(5 + i * 4, 6 + (i % 2) * 4, 3, 5);
      for (let i = 0; i < 12; i++) {
        g.fillStyle = ['#e8697a', '#f3c64f', '#f4f0e6', '#b48be0'][Math.floor(rand() * 4)];
        g.beginPath(); g.arc(5 + rand() * 34, 6 + rand() * 8, 1.7, 0, 7); g.fill();
      }
    });
  }

  function lantern() {
    return make(14, 30, 7, 28, (g) => {
      shadow(g, 7, 28, 5, 2);
      g.fillStyle = '#3c3a3a'; g.fillRect(6, 9, 2, 19);
      g.fillStyle = '#3c3a3a'; g.fillRect(3, 2, 8, 2);
      g.fillStyle = '#f2d589'; g.fillRect(4, 4, 6, 6);
      g.strokeStyle = '#3c3a3a'; g.lineWidth = 1; g.strokeRect(4, 4, 6, 6);
    });
  }

  // Soft round light used for windows and lanterns at night.
  function glowSprite() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,214,140,.85)');
    gr.addColorStop(0.35, 'rgba(255,170,80,.28)');
    gr.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return c;
  }

  HS.buildSprites = function () {
    const rand = HS.rng(7);
    const greens = [
      ['#3f6b3a', '#57894a', '#7fae5d'],
      ['#34604a', '#4a7d5e', '#6fa57a'],
      ['#5c7a34', '#7d9a41', '#a4bd5a'],
    ];
    const blossom = ['#b96f80', '#dc93a4', '#f2c3cc'];
    const roofs = [['#c0563f', '#8e3b2b'], ['#3f7f86', '#2b5a60'], ['#6d6f9c', '#4b4d73'], ['#c98a3b', '#93622a']];
    const walls = ['#f1e6cc', '#ead9bd', '#f4ecdc'];

    const s = { house: [], tree: [], blossom: [], pine: [], bush: [], flowerbed: [], lantern: lantern(), glow: glowSprite() };
    // houses come in two widths: 3 cells and 4 cells
    for (const cells of [3, 4]) {
      for (let i = 0; i < roofs.length; i++) {
        const h = house(cells * HS.CS - 8, roofs[i][0], roofs[i][1], walls[i % walls.length], rand);
        h.cells = cells;
        s.house.push(h);
      }
    }
    for (const cols of greens) for (const r of [14, 17, 20]) s.tree.push(roundTree(r, cols));
    for (const r of [13, 16]) s.blossom.push(roundTree(r, blossom));
    for (const hgt of [38, 48]) { s.pine.push(pine(hgt, ['#2f5d4c', '#3f7a60'])); s.pine.push(pine(hgt, ['#35603a', '#4c8050'])); }
    for (const cols of greens) s.bush.push(bush(cols));
    for (let i = 0; i < 3; i++) s.flowerbed.push(flowerbed(rand));
    return s;
  };

  // Stamp a sprite with its "foot" at (x, y). scale shrinks it toward the foot,
  // which is how buildings and trees tuck away and grow back.
  HS.drawSprite = function (g, sp, x, y, scale, lean) {
    const w = sp.w * scale, h = sp.h * scale;
    if (lean) {
      g.save(); g.translate(x, y); g.transform(1, 0, lean, 1, 0, 0);
      g.drawImage(sp.canvas, -sp.ax * scale, -sp.ay * scale, w, h);
      g.restore();
    } else {
      g.drawImage(sp.canvas, x - sp.ax * scale, y - sp.ay * scale, w, h);
    }
  };
})(window.HS);
