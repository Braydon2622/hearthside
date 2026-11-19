// Ties everything together: builds the world, runs the 30-frames-per-second loop,
// draws the layers, and handles time of day.
//
// The picture is four stacked layers, bottom to top:
//   ground   - grass, plazas, lanes (graphics card; repainted only when the ground changes)
//   sprites  - buildings, trees, props, lanterns (repainted only when something grows or shrinks)
//   actors   - villagers, smoke, birds (repainted every frame, but it is only a handful of things)
//   glow     - window and lantern light at night (repainted only when the light level changes)
// Keeping the still things on their own layers is what keeps processor use low.
(function (HS) {
  const $ = (id) => document.getElementById(id);
  const groundCv = $('ground'), spriteCv = $('sprites'), actorCv = $('actors'), glowCv = $('glow');
  const sg = spriteCv.getContext('2d'), ag = actorCv.getContext('2d'), gg = glowCv.getContext('2d');
  const sprites = HS.buildSprites();
  const ground = new HS.Ground(groundCv);
  let world, villagers, icons;
  const smoke = [], birds = [];
  let time = 0, tintKey = '', glowKey = '', spritesDirty = true;

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

  // The tint moves in small steps, and everything is re-tinted only when it actually steps.
  function applyTint(amb) {
    const q = amb.map((v) => Math.round(v * 64) / 64), key = q.join(',');
    if (key === tintKey) return;
    tintKey = key;
    HS.setTint(q);
    spritesDirty = true; world.dirty = true;
  }

  // --- setup ------------------------------------------------------------------
  function build() {
    const w = window.innerWidth, h = window.innerHeight;
    for (const c of [groundCv, spriteCv, actorCv, glowCv]) { c.width = w; c.height = h; }
    world = new HS.World(w, h, sprites);
    if (!icons) icons = NATIVE ? new HS.NativeIcons(onIconsChanged) : new HS.Icons($('icons'), onIconsChanged);
    else icons.reflow();
    world.update(icons.rects(), null);
    villagers = new HS.Villagers(world);
    smoke.length = 0; birds.length = 0;
    for (let i = 0; i < 4; i++) birds.push(newBird(true));
    spritesDirty = true; glowKey = '';
    HS.app = { world, villagers, icons };
    if (paused) tick(0);
  }

  function onIconsChanged(drop) {
    // While paused (desktop hidden) there is no animation: the change is applied at once and
    // painted a single time, so the desktop is already correct when it comes back into view.
    world.update(icons.rects(), paused ? null : drop);
    villagers.worldChanged(paused ? null : drop);
    spritesDirty = true;
    if (paused) tick(0);
  }

  function newBird(anywhere) {
    const dir = Math.random() < 0.5 ? 1 : -1, w = window.innerWidth, h = window.innerHeight;
    return { x: anywhere ? Math.random() * w : (dir > 0 ? -40 : w + 40), y: Math.random() * h * 0.8, vx: dir * (50 + Math.random() * 40),
      vy: (Math.random() - 0.5) * 16, phase: Math.random() * 6, wait: anywhere ? 0 : 3 + Math.random() * 14 };
  }

  // --- drawing ----------------------------------------------------------------
  // Everything that stands still, in depth order: lower on screen = drawn later = in front.
  // world.objects is already sorted; props and lanterns are sorted here and merged in.
  function standing() {
    const extra = [];
    for (const l of world.lanterns.values()) if (l.scale > 0.02) extra.push({ sp: sprites.lantern, x: l.x, y: l.y, scale: l.scale });
    for (const p of world.props.values()) if (p.scale > 0.02) extra.push(p);
    extra.sort((a, b) => a.y - b.y);
    return extra;
  }

  function drawSprites() {
    sg.clearRect(0, 0, spriteCv.width, spriteCv.height);
    const extra = standing();
    let i = 0;
    for (const o of world.objects) {
      while (i < extra.length && extra[i].y <= o.y) { const e = extra[i++]; HS.drawSprite(sg, e.sp, e.x, e.y, e.scale); }
      if (o.scale >= 0.02) HS.drawSprite(sg, o.sp, o.x, o.y, o.scale);
    }
    while (i < extra.length) { const e = extra[i++]; HS.drawSprite(sg, e.sp, e.x, e.y, e.scale); }
  }

  function drawActors(dt) {
    const w = actorCv.width, h = actorCv.height;
    ag.clearRect(0, 0, w, h);

    // Villagers live on their own layer above the scenery, so anything that should be in FRONT
    // of a villager (a tree or house lower on the screen) is re-stamped over them, inside a
    // small box around the villager so it cannot disturb anything else.
    const extra = standing();
    const walkers = villagers.list.filter((v) => v.state !== 'inside').sort((a, b) => a.y - b.y);
    for (const v of walkers) {
      const bx = v.x - 15, by = v.y - 46, bw = 30, bh = 51;
      ag.save(); ag.beginPath(); ag.rect(bx, by, bw, bh); ag.clip();
      HS.drawVillager(ag, v);
      const front = [];
      const consider = (o) => {
        if (o.y <= v.y || o.scale < 0.02 || Math.abs(o.x - v.x) > 80 || o.y - v.y > 120) return;
        const sx = o.x - o.sp.ax * o.scale, sy = o.y - o.sp.ay * o.scale;
        if (sx < bx + bw && sx + o.sp.w * o.scale > bx && sy < by + bh && sy + o.sp.h * o.scale > by) front.push(o);
      };
      for (const o of world.objects) consider(o);
      for (const o of extra) consider(o);
      front.sort((a, b) => a.y - b.y);
      for (const o of front) HS.drawSprite(ag, o.sp, o.x, o.y, o.scale);
      ag.restore();
    }

    // chimney smoke
    for (const hs of world.allHouses()) {
      if (hs.scale < 0.95) continue;
      hs.smoke -= dt;
      if (hs.smoke <= 0) {
        hs.smoke = 0.7 + Math.random() * 0.9;
        smoke.push({ x: hs.x + hs.sp.chimney.x, y: hs.y + hs.sp.chimney.y, vx: 5 + Math.random() * 5, vy: -11 - Math.random() * 5, life: 0, max: 2.6 + Math.random() * 1.2 });
      }
    }
    const t = HS.tint, smokeRgb = Math.round(245 * t[0]) + ',' + Math.round(242 * t[1]) + ',' + Math.round(235 * t[2]);
    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i];
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life >= p.max) { smoke.splice(i, 1); continue; }
      const k = p.life / p.max;
      ag.fillStyle = 'rgba(' + smokeRgb + ',' + (0.5 * (1 - k)).toFixed(3) + ')';
      ag.beginPath(); ag.arc(p.x, p.y, 2.5 + k * 6, 0, 7); ag.fill();
    }

    // birds high above, with their shadows on the ground
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      if (b.wait > 0) { b.wait -= dt; continue; }
      b.x += b.vx * dt; b.y += b.vy * dt; b.phase += dt * 9;
      if (b.x < -60 || b.x > w + 60) { birds[i] = newBird(false); continue; }
      const flap = Math.sin(b.phase) * 4;
      ag.lineCap = 'round'; ag.lineWidth = 2;
      for (const [ox, oy, col] of [[16, 30, 'rgba(30,45,30,.2)'], [0, 0, HS.tc('#f6f3ea')]]) {
        ag.strokeStyle = col;
        ag.beginPath(); ag.moveTo(b.x + ox - 7, b.y + oy - flap); ag.lineTo(b.x + ox, b.y + oy); ag.lineTo(b.x + ox + 7, b.y + oy - flap); ag.stroke();
      }
    }
  }

  // Night lights. Repainted only when the light level steps or the scenery changed.
  function drawGlow(night, force) {
    const level = Math.round(night * 40) / 40, key = level + ':' + world.version;
    if (!force && key === glowKey) return;
    glowKey = key;
    glowCv.style.display = level < 0.02 ? 'none' : 'block';
    gg.clearRect(0, 0, glowCv.width, glowCv.height);
    if (level < 0.02) return;
    const glow = sprites.glow;
    for (const hs of world.allHouses()) {
      if (hs.scale < 0.9) continue;
      if (hs.sp.glowAt) {   // painted houses: a warm glow across the front
        const a = hs.sp.glowAt;
        gg.globalAlpha = level * 0.75;
        gg.drawImage(glow, hs.x + a.x - a.size / 2, hs.y + a.y - a.size / 2, a.size, a.size);
      }
      for (const win of hs.sp.windows) {
        const x = hs.x + win.x, y = hs.y + win.y;
        gg.globalAlpha = level * 0.92;
        gg.fillStyle = '#ffd98a'; gg.fillRect(x, y, win.w, win.h);
        gg.globalAlpha = level * 0.5;
        gg.drawImage(glow, x + win.w / 2 - 26, y + win.h / 2 - 22, 52, 52);
      }
    }
    for (const l of world.lanterns.values()) {
      gg.globalAlpha = level * l.scale * 0.9;
      gg.drawImage(glow, l.x - 42, l.y - 24 - 38, 84, 84);
    }
    gg.globalAlpha = 1;
  }

  // --- main loop, capped at 30 frames per second --------------------------------
  // When a maximised or full-screen window hides the desktop, the Windows side tells us and the
  // loop stops completely until the desktop is visible again.
  let last = 0, paused = false, running = true;
  function frame(now) {
    if (paused) { running = false; return; }
    requestAnimationFrame(frame);
    // 30 frames a second while the village is rearranging, 20 the rest of the time
    // (villagers only stroll, and the lower rate saves about a third of the work).
    if (now - last < (spritesDirty || world.animating || !world.groundSettled ? 31 : 48)) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    tick(dt);
  }

  // One step of the world plus one repaint of whatever needs it.
  function tick(dt) {
    time += dt;
    const h = hourNow();
    const night = keyed(NIGHT, h)[0];
    applyTint(keyed(AMBIENT, h));

    world.step(dt);
    villagers.step(dt, night);
    if (world.dirty) { ground.draw(world); world.dirty = false; }
    const repaint = spritesDirty || world.animating;
    if (repaint) { drawSprites(); spritesDirty = false; }
    drawActors(dt);
    drawGlow(night, repaint);

    if (!NATIVE) {
      $('timeLabel').textContent = fmt(h);
      $('taskClock').textContent = fmt(h);
      if ($('liveClock').checked) $('timeSlider').value = h;
    }
  }
  function setPaused(p) {
    const was = paused;
    paused = p;
    // going to sleep: finish any half-done rearranging so the picture left on screen is complete
    if (p && !was && world) { world.update(icons.rects(), null); villagers.worldChanged(null); spritesDirty = true; tick(0); }
    if (!p && !running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
  }
  HS.setPaused = setPaused;
  if (NATIVE) {
    window.__TAURI__.event.listen('wallpaper-covered', (e) => setPaused(!!e.payload));
    // the first message may have been sent before this page finished loading, so also ask
    window.__TAURI__.core.invoke('get_covered').then((c) => setPaused(!!c)).catch(() => {});
  }

  $('timeSlider').addEventListener('input', () => { $('liveClock').checked = false; });
  $('addIcon').addEventListener('click', () => icons.add());
  $('removeIcon').addEventListener('click', () => icons.removeLast());
  $('resetIcons').addEventListener('click', () => icons.reset());
  $('fillIcons').addEventListener('click', () => icons.fill());
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(build, 200); });

  // Start with the code-drawn placeholders, then swap in the painted art as soon as it has loaded.
  build();
  requestAnimationFrame(frame);
  HS.loadArt(sprites).then(() => { tintKey = ''; build(); });
  ground.loadTextures(() => { if (world) { world.dirty = true; if (paused) tick(0); } });
})(window.HS);
