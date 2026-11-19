// Stand-in desktop icons for the browser prototype. In the real app these are replaced
// by the actual icon positions read from Windows; everything else only ever sees
// a list of rectangles, so it will not know the difference.
(function (HS) {
  const KEY = 'hearthside.icons.v1';
  const GLYPHS = {
    folder: '<path d="M4 12a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#e9b84a"/><path d="M4 17h36v18a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#f6d06a"/>',
    doc: '<path d="M10 4h17l8 8v25a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" fill="#f7f7f5"/><path d="M27 4v8h8z" fill="#cfd4dc"/><path d="M13 19h17M13 24h17M13 29h11" stroke="#8f98a8" stroke-width="2"/>',
    image: '<rect x="5" y="8" width="34" height="28" rx="3" fill="#f7f7f5"/><rect x="8" y="11" width="28" height="22" fill="#8fc6e8"/><circle cx="16" cy="18" r="3" fill="#f7dc6f"/><path d="M8 33l9-10 6 6 5-4 8 8z" fill="#5a9a5a"/>',
    music: '<rect x="6" y="6" width="32" height="32" rx="8" fill="#d8587a"/><path d="M19 29V15l11-2v13" stroke="#fff" stroke-width="2.5" fill="none"/><circle cx="16.5" cy="29" r="3.2" fill="#fff"/><circle cx="27.5" cy="26" r="3.2" fill="#fff"/>',
    app: '<rect x="6" y="6" width="32" height="32" rx="8" fill="#4a86c8"/><path d="M14 28l8-12 8 12z" fill="#fff"/>',
    bin: '<path d="M12 14h20l-2 22a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3z" fill="#dfe6ee"/><rect x="10" y="10" width="24" height="4" rx="2" fill="#b9c4d2"/><path d="M19 19v14M25 19v14" stroke="#9aa7b8" stroke-width="2"/>',
  };
  const NAMES = [['Projects', 'folder'], ['Resume.pdf', 'doc'], ['Photos', 'folder'], ['Notes.txt', 'doc'], ['Sketch.png', 'image'], ['Playlist', 'music'],
    ['Hearthside', 'app'], ['Recycle Bin', 'bin'], ['Taxes', 'folder'], ['Trip.jpg', 'image'], ['Browser', 'app'], ['Ideas.txt', 'doc'], ['School', 'folder'],
    ['Song.mp3', 'music'], ['Budget.xlsx', 'doc'], ['Games', 'folder'], ['Cat.png', 'image'], ['Editor', 'app']];

  HS.Icons = function (container, onChange) {
    this.el = container; this.onChange = onChange; this.items = [];
    this.measure();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* storage may be unavailable */ }
    if (Array.isArray(saved) && saved.length) saved.forEach((s) => this.create(s.name, s.type, s.col, s.row));
    else this.defaults();
    this.reflow();
  };
  const P = HS.Icons.prototype;

  P.measure = function () {
    this.cols = Math.max(2, Math.floor((window.innerWidth - HS.ICON_MX * 2) / HS.ICON_W));
    this.rows = Math.max(2, Math.floor((window.innerHeight - HS.TASKBAR - HS.ICON_MY * 2) / HS.ICON_H));
  };

  P.defaults = function () {
    const c = this.cols, r = this.rows, spots = [];
    for (let i = 0; i < Math.min(6, r); i++) spots.push([0, i]);
    for (let i = 0; i < Math.min(3, r); i++) spots.push([1, i]);
    spots.push([c - 3, 1], [c - 2, 1], [c - 3, 2], [c - 2, 2]);
    spots.push([Math.floor(c / 2), Math.floor(r / 2)]);
    spots.push([Math.floor(c * 0.3), r - 2], [Math.floor(c * 0.3) + 1, r - 2]);
    spots.forEach((s, i) => this.create(NAMES[i % NAMES.length][0], NAMES[i % NAMES.length][1], s[0], s[1]));
  };

  P.create = function (name, type, col, row) {
    const el = document.createElement('div');
    el.className = 'icon';
    el.innerHTML = '<svg class="glyph" viewBox="0 0 44 44">' + (GLYPHS[type] || GLYPHS.doc) + '</svg><div class="label"></div>';
    el.querySelector('.label').textContent = name;
    this.el.appendChild(el);
    const it = { name, type, col, row, el };
    this.items.push(it);
    this.attach(it);
    return it;
  };

  P.pos = function (col, row) { return { x: HS.ICON_MX + col * HS.ICON_W, y: HS.ICON_MY + row * HS.ICON_H }; };
  P.place = function (it) { const p = this.pos(it.col, it.row); it.el.style.left = p.x + 'px'; it.el.style.top = p.y + 'px'; };
  P.taken = function (col, row, except) { return this.items.some((o) => o !== except && o.col === col && o.row === row); };

  // Nearest empty grid cell to the one asked for.
  P.freeNear = function (col, row, except) {
    col = HS.clamp(col, 0, this.cols - 1); row = HS.clamp(row, 0, this.rows - 1);
    let best = null, bd = Infinity;
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      if (this.taken(c, r, except)) continue;
      const d = Math.hypot(c - col, r - row);
      if (d < bd) { bd = d; best = [c, r]; }
    }
    return best;
  };

  P.reflow = function () {
    this.measure();
    for (const it of this.items) {
      if (it.col >= this.cols || it.row >= this.rows || it.col < 0 || it.row < 0 || this.taken(it.col, it.row, it)) {
        const f = this.freeNear(it.col, it.row, it); if (f) { it.col = f[0]; it.row = f[1]; }
      }
      this.place(it);
    }
  };

  P.attach = function (it) {
    const el = it.el;
    let off = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = el.getBoundingClientRect();
      off = { x: e.clientX - r.left, y: e.clientY - r.top };
      el.setPointerCapture(e.pointerId); el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!off) return;
      el.style.left = (e.clientX - off.x) + 'px'; el.style.top = (e.clientY - off.y) + 'px';
    });
    const end = (e) => {
      if (!off) return;
      const x = e.clientX - off.x, y = e.clientY - off.y;
      off = null; el.classList.remove('dragging');
      const f = this.freeNear(Math.round((x - HS.ICON_MX) / HS.ICON_W), Math.round((y - HS.ICON_MY) / HS.ICON_H), it);
      const moved = f && (f[0] !== it.col || f[1] !== it.row);
      if (f) { it.col = f[0]; it.row = f[1]; }
      this.place(it);
      if (moved) { this.save(); this.changed(it); }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  P.changed = function (it) {
    const p = this.pos(it.col, it.row);
    this.onChange({ x: p.x + HS.ICON_W / 2, y: p.y + HS.ICON_H / 2 });
  };

  P.save = function () {
    try { localStorage.setItem(KEY, JSON.stringify(this.items.map((i) => ({ name: i.name, type: i.type, col: i.col, row: i.row })))); } catch (e) { /* ignore */ }
  };

  // The only thing the world needs: one rectangle per icon, in screen pixels.
  P.rects = function () {
    return this.items.map((it) => { const p = this.pos(it.col, it.row); return { x: p.x, y: p.y, w: HS.ICON_W, h: HS.ICON_H }; });
  };

  P.add = function () {
    const free = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (!this.taken(c, r)) free.push([c, r]);
    if (!free.length) return;
    const f = free[Math.floor(Math.random() * free.length)], n = NAMES[this.items.length % NAMES.length];
    const it = this.create(n[0], n[1], f[0], f[1]);
    this.place(it); this.save(); this.changed(it);
  };

  // Test helper: crowd the desktop the way a really full one looks, leaving a few empty slots.
  P.fill = function (rand) {
    rand = rand || Math.random;
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      if (this.taken(c, r) || rand() < 0.06) continue;
      const n = NAMES[this.items.length % NAMES.length];
      this.place(this.create(n[0], n[1], c, r));
    }
    this.save(); this.onChange(null);
  };

  P.removeLast = function () {
    const it = this.items.pop(); if (!it) return;
    it.el.remove(); this.save(); this.changed(it);
  };

  // The real thing: icon rectangles sent by the Windows side of the app (see src-tauri/src/desktop.rs).
  // It offers the same rects()/reflow() as the fake icons above, so the rest of the code is unchanged.
  HS.NativeIcons = function (onChange) {
    this.list = [];
    const key = (r) => r.x + ',' + r.y;
    const apply = (rects) => {
      const old = new Set(this.list.map(key)), now = new Set(rects.map(key));
      // the icon that appeared somewhere new (or, failing that, one that vanished) is where the change ripples from
      const moved = rects.find((r) => !old.has(key(r))) || this.list.find((r) => !now.has(key(r)));
      const first = !this.ready;
      this.list = rects; this.ready = true;
      if (first) onChange(null);
      else if (moved) onChange({ x: moved.x + moved.w / 2, y: moved.y + moved.h / 2 });
    };
    const T = window.__TAURI__;
    T.event.listen('desktop-icons', (e) => apply(e.payload));
    T.core.invoke('get_icons').then(apply).catch((err) => console.error('get_icons failed', err));
  };
  HS.NativeIcons.prototype.rects = function () { return this.list; };
  HS.NativeIcons.prototype.reflow = function () {};

  P.reset = function () {
    this.items.forEach((i) => i.el.remove()); this.items = [];
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    this.defaults(); this.reflow();
    this.onChange(null);
  };
})(window.HS);
