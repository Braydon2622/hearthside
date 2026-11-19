// Ties everything together: builds the world, runs the 30-frames-per-second loop,
// draws the layers, and handles time of day.
(function (HS) {
  const $ = (id) => document.getElementById(id);
  const groundCv = $('ground'), spriteCv = $('sprites'), glowCv = $('glow'), tint = $('tint');
  const sg = spriteCv.getContext('2d'), gg = glowCv.getContext('2d');
  const sprites = HS.buildSprites();
  const ground = new HS.Ground(groundCv);
  let world, villagers, icons;
  const smoke = [], birds = [];
  let time = 0;

  // Running inside the real Windows app (as opposed to a browser tab)? Then the icons are the
  // user's actual desktop icons, and the fake icons, fake taskbar and test panel are not needed.
  const NATIVE = !!window.__TAURI__;
  if (NATIVE) for (const id of ['icons', 'taskbar', 'panel']) $(id).style.display = 'none';

  // --- time of day ------------------------------------------------------------
  // Colour the whole scene is multiplied by, at given hours of the day.
  const AMBIENT = [[0, .36, .42, .72], [4.5, .36, .42, .72], [6, .95, .72, .70], [7.5, 1, .96, .90], [9, 1, 1, 1], [16.5, 1, 1, 1],
    [18.5, 1, .78, .60], [20, .62, .50, .72], [21.5, .36, .42, .72], [24, .36, .42, .72]];
  const NIGHT = [[0, 1], [5, 1], [6.5, 0], [18.3, 0], [20.5, 1], [24, 1]];
  function keyed(keys, h) {
    for (let i = 1; i < keys.length; i++) if (h <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i], t = (h - a[0]) / (b[0] - a[0]);
      return a.slice(1).map((v, j) => HS.lerp(v, b[j + 1], t));
    }
    return keys[keys.length - 1].slice(1);
  }
  function hourNow() {
    if ($('liveClock').checked) { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }
    return parseFloat($('timeSlider').value) % 24;
  }
  const fmt = (h) => String(Math.floor(h) % 24).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0');

  // --- setup ------------------------------------------------------------------
  function build() {
    const w = window.innerWidth, h = window.innerHeight;
    for (const c of [groundCv, spriteCv, glowCv]) { c.width = w; c.height = h; }
    world = new HS.World(w, h, sprites);
    if (!icons) icons = NATIVE ? new HS.NativeIcons(onIconsChanged) : new HS.Icons($('icons'), onIconsChanged);
    else icons.reflow();
    world.update(icons.rects(), null);
    villagers = new HS.Villagers(world);
    smoke.length = 0; birds.length = 0;
    for (let i = 0; i < 4; i++) birds.push(newBird(true));
    HS.app = { world, villagers, icons };
  }

  function onIconsChanged(drop) {
    world.update(icons.rects(), drop);
    villagers.worldChanged(drop);
  }

  function newBird(anywhere) {
    const dir = Math.random() < 0.5 ? 1 : -1, w = window.innerWidth, h = window.innerHeight;
    return { x: anywhere ? Math.random() * w : (dir > 0 ? -40 : w + 40), y: Math.random() * h * 0.8, vx: dir * (50 + Math.random() * 40),
      vy: (Math.random() - 0.5) * 16, phase: Math.random() * 6, wait: anywhere ? 0 : 3 + Math.random() * 14 };
  }

  // --- drawing ----------------------------------------------------------------
  function drawSprites(dt) {
    const w = spriteCv.width, h = spriteCv.height;
    sg.clearRect(0, 0, w, h);

    // moving things (villagers, lanterns) sorted by depth, then merged with the buildings and
    // trees, which are already in depth order. Lower on screen = drawn later = in front.
    const movers = [];
    for (const v of villagers.list) if (v.state !== 'inside') movers.push({ y: v.y, v });
    for (const l of world.lanterns.values()) if (l.scale > 0.02) movers.push({ y: l.y, l });
    for (const p of world.props.values()) if (p.scale > 0.02) movers.push({ y: p.y, p });
    movers.sort((a, b) => a.y - b.y);
    let mi = 0;
    const flush = (y) => {
      while (mi < movers.length && movers[mi].y <= y) {
        const m = movers[mi++];
        if (m.v) HS.drawVillager(sg, m.v);
        else if (m.l) HS.drawSprite(sg, sprites.lantern, m.l.x, m.l.y, m.l.scale);
        else HS.drawSprite(sg, m.p.sp, m.p.x, m.p.y, m.p.scale, m.p.sway ? Math.sin(time * 1.3 + m.p.phase) * 0.025 : 0);
      }
    };
    for (const o of world.objects) {
      flush(o.y);
      if (o.scale < 0.02) continue;
      HS.drawSprite(sg, o.sp, o.x, o.y, o.scale, o.sway ? Math.sin(time * 1.3 + o.phase) * 0.025 : 0);
    }
    flush(Infinity);

    // chimney smoke
    for (const hs of world.allHouses()) {
      if (hs.scale < 0.95) continue;
      hs.smoke -= dt;
      if (hs.smoke <= 0) {
        hs.smoke = 0.7 + Math.random() * 0.9;
        smoke.push({ x: hs.x + hs.sp.chimney.x, y: hs.y + hs.sp.chimney.y, vx: 5 + Math.random() * 5, vy: -11 - Math.random() * 5, life: 0, max: 2.6 + Math.random() * 1.2 });
      }
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i];
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life >= p.max) { smoke.splice(i, 1); continue; }
      const t = p.life / p.max;
      sg.fillStyle = 'rgba(245,242,235,' + (0.5 * (1 - t)).toFixed(3) + ')';
      sg.beginPath(); sg.arc(p.x, p.y, 2.5 + t * 6, 0, 7); sg.fill();
    }

    // birds high above, with their shadows on the ground
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      if (b.wait > 0) { b.wait -= dt; continue; }
      b.x += b.vx * dt; b.y += b.vy * dt; b.phase += dt * 9;
      if (b.x < -60 || b.x > w + 60) { birds[i] = newBird(false); continue; }
      const flap = Math.sin(b.phase) * 4;
      sg.lineCap = 'round'; sg.lineWidth = 2;
      for (const [ox, oy, col] of [[16, 30, 'rgba(30,45,30,.2)'], [0, 0, '#f6f3ea']]) {
        sg.strokeStyle = col;
        sg.beginPath(); sg.moveTo(b.x + ox - 7, b.y + oy - flap); sg.lineTo(b.x + ox, b.y + oy); sg.lineTo(b.x + ox + 7, b.y + oy - flap); sg.stroke();
      }
    }
  }

  function drawGlow(night) {
    gg.clearRect(0, 0, glowCv.width, glowCv.height);
    if (night < 0.02) return;
    const glow = sprites.glow;
    for (const hs of world.allHouses()) {
      if (hs.scale < 0.9) continue;
      const flick = 0.9 + Math.sin(time * 3 + hs.phase * 5) * 0.06;
      for (const win of hs.sp.windows) {
        const x = hs.x + win.x, y = hs.y + win.y;
        gg.globalAlpha = night * flick;
        gg.fillStyle = '#ffd98a'; gg.fillRect(x, y, win.w, win.h);
        gg.globalAlpha = night * 0.55 * flick;
        gg.drawImage(glow, x + win.w / 2 - 26, y + win.h / 2 - 22, 52, 52);
      }
    }
    for (const l of world.lanterns.values()) {
      gg.globalAlpha = night * l.scale;
      gg.drawImage(glow, l.x - 42, l.y - 24 - 38, 84, 84);
    }
    gg.globalAlpha = 1;
  }

  // --- main loop, capped at 30 frames per second --------------------------------
  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - last < 31) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now; time += dt;

    const h = hourNow();
    const amb = keyed(AMBIENT, h), night = keyed(NIGHT, h)[0];
    tint.style.backgroundColor = 'rgb(' + amb.map((v) => Math.round(v * 255)).join(',') + ')';

    world.step(dt);
    villagers.step(dt, night);
    if (world.dirty) { ground.draw(world); world.dirty = false; }
    drawSprites(dt);
    drawGlow(night);

    $('timeLabel').textContent = fmt(h);
    $('taskClock').textContent = fmt(h);
    if ($('liveClock').checked) $('timeSlider').value = h;
  }

  $('timeSlider').addEventListener('input', () => { $('liveClock').checked = false; });
  $('addIcon').addEventListener('click', () => icons.add());
  $('removeIcon').addEventListener('click', () => icons.removeLast());
  $('resetIcons').addEventListener('click', () => icons.reset());
  $('fillIcons').addEventListener('click', () => icons.fill());
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(build, 200); });

  build();
  requestAnimationFrame(frame);
})(window.HS);
