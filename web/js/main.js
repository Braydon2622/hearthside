// Ties the code-art world together: builds the world from the icons, keeps the still layer (flora,
// stars) and the creatures up to date, follows the time of day and the mouse cursor, and runs the
// frame loop.
//
// The picture is one WebGL2 canvas (see render.js). The ground is painted off-screen and only
// repainted while it morphs or the colours of the hour move; the still layer is uploaded only when
// the icons change; the creatures are drawn every frame into a trail picture that keeps a fading
// ghost of their movement.
(function (HS) {
  const $ = (id) => document.getElementById(id);
  const canvas = $('scene');
  const renderer = new HS.Renderer(canvas);
  let world, creatures, icons;
  let time = 0, palKey = '';

  // Running inside the real Windows app (as opposed to a browser tab)? Then the icons are the
  // user's actual desktop icons, and the fake icons, fake taskbar and test panel are not needed.
  const NATIVE = !!window.__TAURI__;
  if (NATIVE) for (const id of ['icons', 'taskbar', 'panel']) $(id).style.display = 'none';

  function hourNow() {
    if ($('liveClock').checked) { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }
    return parseFloat($('timeSlider').value) % 24;
  }
  const fmt = (h) => String(Math.floor(h) % 24).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0');

  // --- setup ------------------------------------------------------------------
  function build() {
    const w = HS.viewW(), h = HS.viewH();
    renderer.resize(w, h);
    HS.setHour(hourNow()); palKey = HS.pal.key;
    world = new HS.World(w, h, null);
    if (!icons) icons = NATIVE ? new HS.NativeIcons(onIconsChanged) : new HS.Icons($('icons'), onIconsChanged);
    else icons.reflow();
    world.update(icons.rects(), null);
    HS.buildFlora(world, renderer);
    creatures = new HS.Creatures(world);
    renderer.groundDirty = true;
    HS.app = { world, creatures, icons, renderer };
    if (paused) tick(0);
  }

  function onIconsChanged(drop) {
    // While paused (desktop hidden) there is no animation: the change is applied at once and
    // painted a single time, so the desktop is already correct when it comes back into view.
    world.update(icons.rects(), paused ? null : drop);
    HS.buildFlora(world, renderer);
    creatures.worldChanged(paused ? null : drop);
    if (paused) tick(0);
  }

  // The status line: a quiet corner readout, in whichever corner is furthest from the icons.
  function hud(h) {
    const g = renderer.hud, P = HS.pal;
    g.reset();
    const s = 'hearthside.ascii  ' + String(icons.rects().length).padStart(2, '0') + ' nodes  ' +
      creatures.walkers.length + ' walkers  ' + creatures.jellies.length + ' drifters  ' + fmt(h);
    const size = 11, wpx = s.length * size * 0.6, bottom = world.height - HS.TASKBAR - 16;
    const corners = [[16, bottom], [world.width - wpx - 16, bottom], [world.width - wpx - 16, 18], [16, 18]];
    let best = corners[0], bd = -1;
    for (const [x, y] of corners) {
      let d = Infinity;
      for (let k = 0; k <= 4; k++) d = Math.min(d, world.field.at(x + wpx * k / 4, y, 1));
      if (d > bd) { bd = d; best = [x, y]; }
    }
    g.text(s, best[0] + size * 0.3, best[1], size, P.star, 0.45);
  }

  // --- main loop -------------------------------------------------------------------
  // A plain timer, 20 frames a second (30 while the ground morphs). When a maximised or full-screen
  // window hides the desktop, the Windows side tells us and the loop stops until it is visible again.
  let last = performance.now(), paused = false, running = true;
  function frame() {
    if (paused) { running = false; return; }
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    tick(dt);
    const interval = world.field.morphing ? 33 : 50;
    setTimeout(frame, Math.max(4, interval - (performance.now() - now)));
  }

  function tick(dt) {
    time += dt;
    const h = hourNow();
    HS.setHour(h);
    if (HS.pal.key !== palKey) { palKey = HS.pal.key; renderer.groundDirty = true; HS.buildFlora(world, renderer); }

    world.step(dt);
    creatures.step(dt);
    creatures.draw(renderer.moving, renderer.movingGlyphs);
    hud(h);
    // trails: about 40 % of the light survives each 50 ms frame, so ghosts last a few tenths of a second
    renderer.render(world, time, paused || dt === 0, Math.pow(0.4, dt / 0.05));
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
    if (p && !was && world) { world.update(icons.rects(), null); HS.buildFlora(world, renderer); creatures.worldChanged(null); tick(0); }
    if (!p && !running) { running = true; last = performance.now(); setTimeout(frame, 0); }
  }
  HS.setPaused = setPaused;

  // The mouse cursor: in the browser from pointer events, in the real app from the Windows side
  // (the wallpaper never receives mouse events itself, it sits behind the icons).
  window.addEventListener('pointermove', (e) => { if (creatures) creatures.setCursor(e.clientX, e.clientY); });
  if (NATIVE) {
    window.__TAURI__.event.listen('wallpaper-covered', (e) => setPaused(!!e.payload));
    window.__TAURI__.event.listen('cursor', (e) => { if (creatures && e.payload) creatures.setCursor(e.payload.x, e.payload.y); });
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

  build();
  if (!NATIVE && Q.has('fill')) icons.fill(HS.rng(5));
  setTimeout(frame, 0);
})(window.HS);
