// Ties everything together: builds the world, runs the frame loop, fills the renderer with
// everything that stands on the ground, and handles time of day.
//
// The whole picture is one WebGL2 canvas (see render.js): the ground is painted off-screen and
// only repainted while it morphs; buildings, trees, props and villagers are drawn on top in one
// batch every frame; a finishing pass adds cloud shadows and the time of day.
(function (HS) {
  const $ = (id) => document.getElementById(id);
  const canvas = $('scene');
  const sprites = HS.buildSprites();
  const renderer = new HS.Renderer(canvas);
  renderer.setSprites(HS.allSprites(sprites));
  let world, villagers, icons;
  const smoke = [], birds = [];
  let time = 0;

  // Running inside the real Windows app (as opposed to a browser tab)? Then the icons are the
  // user's actual desktop icons, and the fake icons, fake taskbar and test panel are not needed.
  const NATIVE = !!window.__TAURI__;
  if (NATIVE) for (const id of ['icons', 'taskbar', 'panel']) $(id).style.display = 'none';

  // --- time of day ------------------------------------------------------------
  // The colour grade over the finished frame, at given hours of the day:
  //   hour, gain r g b (highlights multiplied by), lift r g b (shadows raised toward),
  //   saturation, contrast (S-curve), bloom strength, bloom threshold
  const GRADE = [
    [0,    .30, .36, .64,  .008, .014, .036,  .66, .16, .55, .55],
    [4.5,  .30, .36, .64,  .008, .014, .036,  .66, .16, .55, .55],
    [6,    .96, .72, .66,  .060, .030, .060,  .95, .12, .45, .62],
    [7.5, 1.03, .97, .88,  .020, .012, .020, 1.05, .15, .32, .70],
    [9,   1.04, 1.01, .95, .010, .008, .012, 1.08, .18, .28, .74],
    [16.5,1.04, 1.01, .95, .010, .008, .012, 1.08, .18, .28, .74],
    [18.5,1.10, .82, .62,  .060, .020, .080, 1.14, .20, .55, .62],
    [20,   .62, .50, .72,  .040, .030, .080,  .82, .14, .55, .58],
    [21.5, .30, .36, .64,  .008, .014, .036,  .66, .16, .55, .55],
    [24,   .30, .36, .64,  .008, .014, .036,  .66, .16, .55, .55]];
  const NIGHT = [[0, 1], [5, 1], [6.5, 0], [18.3, 0], [20.5, 1], [24, 1]];
  // How tall each kind of thing stands, for the length of its shadow (pixels).
  const CAST = { house: 18, tree: 22, pine: 26, blossom: 20, bush: 7, cypress: 18, flowerbed: 3, tub: 5, decor: 8, lantern: 14 };
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
    const w = HS.viewW(), h = HS.viewH();
    renderer.resize(w, h);
    world = new HS.World(w, h, sprites);
    if (!icons) icons = NATIVE ? new HS.NativeIcons(onIconsChanged) : new HS.Icons($('icons'), onIconsChanged);
    else icons.reflow();
    world.update(icons.rects(), null);
    villagers = new HS.Villagers(world);
    smoke.length = 0; birds.length = 0;
    for (let i = 0; i < 4; i++) birds.push(newBird(true));
    renderer.groundDirty = true;
    HS.app = { world, villagers, icons, renderer };
    if (paused) tick(0);
  }

  function onIconsChanged(drop) {
    // While paused (desktop hidden) there is no animation: the change is applied at once and
    // painted a single time, so the desktop is already correct when it comes back into view.
    world.update(icons.rects(), paused ? null : drop);
    villagers.worldChanged(paused ? null : drop);
    if (paused) tick(0);
  }

  function newBird(anywhere) {
    const dir = Math.random() < 0.5 ? 1 : -1, w = HS.viewW(), h = HS.viewH();
    return { x: anywhere ? Math.random() * w : (dir > 0 ? -40 : w + 40), y: Math.random() * h * 0.8, vx: dir * (50 + Math.random() * 40),
      vy: (Math.random() - 0.5) * 16, phase: Math.random() * 6, wait: anywhere ? 0 : 3 + Math.random() * 14 };
  }

  // --- filling the frame --------------------------------------------------------
  // Everything standing, in depth order: lower on screen = drawn later = in front.
  // world.objects is already sorted by y; props, lanterns and villagers are sorted and merged in.
  const extra = [];
  function fillScene(dt) {
    const b = renderer.scene;
    b.reset();
    extra.length = 0;
    for (const l of world.lanterns.values()) if (l.scale > 0.02) extra.push({ kind: 'lantern', sp: sprites.lantern, x: l.x, y: l.y, scale: l.scale });
    for (const p of world.props.values()) if (p.scale > 0.02) extra.push(p);
    for (const v of villagers.list) if (v.state !== 'inside') extra.push({ villager: v, y: v.y });
    extra.sort((a, c) => a.y - c.y);
    let i = 0;
    const put = (e) => { if (e.villager) HS.drawVillager(b, e.villager); else b.sprite(e.sp, e.x, e.y, e.scale, CAST[e.kind] || 6); };
    for (const o of world.objects) {
      while (i < extra.length && extra[i].y <= o.y) put(extra[i++]);
      if (o.scale >= 0.02) b.sprite(o.sp, o.x, o.y, o.scale, CAST[o.kind] || 6);
    }
    while (i < extra.length) put(extra[i++]);

    // chimney smoke
    for (const hs of world.allHouses()) {
      if (hs.scale < 0.95) continue;
      hs.smoke -= dt;
      if (hs.smoke <= 0) {
        hs.smoke = 0.7 + Math.random() * 0.9;
        smoke.push({ x: hs.x + hs.sp.chimney.x, y: hs.y + hs.sp.chimney.y, vx: 5 + Math.random() * 5, vy: -11 - Math.random() * 5, life: 0, max: 2.6 + Math.random() * 1.2 });
      }
    }
    for (let k = smoke.length - 1; k >= 0; k--) {
      const p = smoke[k];
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life >= p.max) { smoke.splice(k, 1); continue; }
      const t = p.life / p.max, s = (2.5 + t * 6) / 8 * 1.15;
      b.add(sprites.puff, p.x, p.y, s, s, false, 0.96, 0.95, 0.92, 0.5 * (1 - t), 0, 0, 0);
    }

    // birds high above, with their shadows on the ground far below
    const w = canvas.width;
    for (let k = 0; k < birds.length; k++) {
      const d = birds[k];
      if (d.wait > 0) { d.wait -= dt; continue; }
      d.x += d.vx * dt; d.y += d.vy * dt; d.phase += dt * 9;
      if (d.x < -60 || d.x > w + 60) { birds[k] = newBird(false); continue; }
      const flap = Math.sin(d.phase);
      // flying high: the shadow lands far from the bird
      b.add(sprites.bird, d.x, d.y, 0.9, flap * 0.9, false, 0.96, 0.95, 0.92, 1, 0, 0, 0, 2, 44);
    }
  }

  // Night lights: a warm glow across the front of each house and around each lantern.
  function fillLights(night) {
    const b = renderer.lights;
    b.reset();
    if (night < 0.02) return;
    const glow = sprites.glow;
    for (const hs of world.allHouses()) {
      if (hs.scale < 0.9) continue;
      if (hs.sp.glowAt) {
        const a = hs.sp.glowAt, s = a.size / glow.w;
        b.add(glow, hs.x + a.x, hs.y + a.y, s, s, false, 1, 1, 1, night * 0.75, 0, 0, 0);
      }
      for (const win of hs.sp.windows) {
        const x = hs.x + win.x, y = hs.y + win.y;
        b.add(sprites.white, x, y, win.w / 4, win.h / 4, false, 1, 0.85, 0.54, night * 0.8, 0, 0, 0);
        b.add(glow, x + win.w / 2, y + win.h / 2 + 4, 52 / 64, 52 / 64, false, 1, 1, 1, night * 0.5, 0, 0, 0);
      }
    }
    for (const l of world.lanterns.values()) b.add(glow, l.x, l.y - 24, 84 / 64, 84 / 64, false, 1, 1, 1, night * l.scale * 0.9, 0, 0, 0);
  }

  // --- main loop -------------------------------------------------------------------
  // When a maximised or full-screen window hides the desktop, the Windows side tells us and the
  // loop stops completely until the desktop is visible again.
  // The loop runs on a plain timer rather than requestAnimationFrame: asking for animation frames
  // keeps the browser's 60-per-second frame machinery awake even on the frames we skip, which
  // costs more processor time than drawing the frames we do want.
  let last = performance.now(), paused = false, running = true;
  function frame() {
    if (paused) { running = false; return; }
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    tick(dt);
    // 30 frames a second while the village is rearranging, 20 the rest of the time
    // (villagers only stroll, and the lower rate saves about a third of the work).
    const interval = world.animating || world.field.morphing ? 33 : 50;
    setTimeout(frame, Math.max(4, interval - (performance.now() - now)));
  }

  // One step of the world plus one frame.
  function tick(dt) {
    time += dt;
    const h = hourNow();
    const night = keyed(NIGHT, h)[0];
    const k = keyed(GRADE, h), gr = renderer.grade;
    gr.gain = k.slice(0, 3); gr.lift = k.slice(3, 6); gr.look = k.slice(6, 9); gr.threshold = k[9];

    world.step(dt);
    villagers.step(dt, night);
    fillScene(dt);
    fillLights(night);
    renderer.render(world, time);
    world.dirty = false;

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
    if (p && !was && world) { world.update(icons.rects(), null); villagers.worldChanged(null); tick(0); }
    if (!p && !running) { running = true; last = performance.now(); setTimeout(frame, 0); }
  }
  HS.setPaused = setPaused;
  if (NATIVE) {
    window.__TAURI__.event.listen('wallpaper-covered', (e) => setPaused(!!e.payload));
    // the first message may have been sent before this page finished loading, so also ask
    window.__TAURI__.core.invoke('get_covered').then((c) => setPaused(!!c)).catch(() => {});
  }

  // Test and screenshot helpers: ?hour=18.5 fixes the time, ?fill=1 crowds the desktop the same
  // way every time, ?clean=1 hides the control panel.
  const Q = new URLSearchParams(location.search);
  if (!NATIVE) {
    if (Q.has('hour')) { $('liveClock').checked = false; $('timeSlider').value = Q.get('hour'); }
    if (Q.has('clean')) $('panel').style.display = 'none';
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
  if (!NATIVE && Q.has('fill')) icons.fill(HS.rng(5));  setTimeout(frame, 0);
  HS.loadArt(sprites).then(() => { renderer.setSprites(HS.allSprites(sprites)); build(); });
  renderer.ground.loadTextures(() => { renderer.groundDirty = true; if (paused && world) tick(0); });
})(window.HS);
