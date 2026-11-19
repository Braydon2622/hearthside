// One WebGL2 renderer for the code-art world.
//
// Everything is either a glowing line segment (a bright core with a soft halo, added on top of what
// is already there, so overlapping light piles up like neon) or a text character from the glyph
// atlas. Both are drawn as instanced quads.
//
// Every frame:
//   1. the moving things (creatures, sparks, rings) are drawn into a "trail" picture that keeps a
//      fading copy of the frames before, which leaves the faint ghost of each movement behind;
//   2. the frame starts as the ground (its own off-screen picture, repainted only while it morphs
//      or the colours of the hour move), then the still layer (flora, stars), then the trails, then
//      the status line;
//   3. bloom (every second frame) spreads the brightest light, and a finishing pass adds it with a
//      soft vignette and a fixed grain.
(function (HS) {
  const LF = 16;   // floats per line: a(2) b(2) | half-width, glow, sway at a, sway at b | rgba | phase, twinkle, -, -
  const GF = 12;   // floats per glyph: x, y, size, char | rgba | phase, twinkle, rotation, -

  const LINE_VS = `#version 300 es
    layout(location = 0) in vec2 aCorner;
    layout(location = 1) in vec4 iAB;
    layout(location = 2) in vec4 iShape;
    layout(location = 3) in vec4 iColor;
    layout(location = 4) in vec4 iMisc;
    uniform vec2 uRes;
    uniform float uTime;
    out vec2 vLocal;
    out float vLen, vHalf, vGlow;
    out vec4 vColor;
    void main() {
      float sw = sin(uTime * 1.25 + iMisc.x) * 0.8 + sin(uTime * 2.3 + iMisc.x * 1.7) * 0.2;
      vec2 a = iAB.xy + vec2(sw * iShape.z, 0.0), b = iAB.zw + vec2(sw * iShape.w, 0.0);
      vec2 d = b - a;
      float len = length(d);
      vec2 dir = len > 0.001 ? d / len : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
      float r = iShape.x + iShape.y * 2.6 + 1.0;
      float s = mix(-r, len + r, aCorner.x), t = mix(-r, r, aCorner.y);
      vec2 p = a + dir * s + nrm * t;
      vLocal = vec2(s, t); vLen = len; vHalf = iShape.x; vGlow = iShape.y;
      float tw = mix(1.0, 0.45 + 0.55 * sin(uTime * (1.3 + iMisc.y * 2.0) + iMisc.x * 7.0), step(0.001, iMisc.y));
      vColor = vec4(iColor.rgb, iColor.a * tw);
      gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
    }`;
  const LINE_FS = `#version 300 es
    precision mediump float;
    in vec2 vLocal;
    in float vLen, vHalf, vGlow;
    in vec4 vColor;
    out vec4 o;
    void main() {
      float ds = max(max(-vLocal.x, vLocal.x - vLen), 0.0);
      float d = length(vec2(ds, vLocal.y));
      float core = 1.0 - smoothstep(vHalf - 0.35, vHalf + 0.65, d);
      float halo = vGlow > 0.0 ? exp(-d * d / (vGlow * vGlow)) * 0.3 : 0.0;
      float k = (core + halo) * vColor.a;
      o = vec4(vColor.rgb * k, k);
    }`;

  const GLYPH_VS = `#version 300 es
    layout(location = 0) in vec2 aCorner;
    layout(location = 1) in vec4 iPos;     // x, y, size, char
    layout(location = 2) in vec4 iColor;
    layout(location = 3) in vec4 iMisc;    // phase, twinkle, rotation
    uniform vec2 uRes;
    uniform float uTime;
    uniform vec2 uCells;                   // columns, rows of the atlas
    out vec2 vUV;
    out vec4 vColor;
    void main() {
      vec2 c = aCorner - 0.5;
      float cr = cos(iMisc.z), sr = sin(iMisc.z);
      vec2 p = iPos.xy + vec2(cr * c.x - sr * c.y, sr * c.x + cr * c.y) * iPos.z;
      float idx = iPos.w, col = mod(idx, uCells.x), row = floor(idx / uCells.x);
      vUV = (vec2(col, row) + aCorner) / uCells;
      float tw = mix(1.0, 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * (0.7 + iMisc.y * 2.5) + iMisc.x * 6.28), 2.0), step(0.001, iMisc.y));
      vColor = vec4(iColor.rgb, iColor.a * tw);
      gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
    }`;
  const GLYPH_FS = `#version 300 es
    precision mediump float;
    uniform sampler2D uAtlas;
    in vec2 vUV;
    in vec4 vColor;
    out vec4 o;
    void main() { float a = texture(uAtlas, vUV).a * vColor.a; o = vec4(vColor.rgb * a, a); }`;

  const QUAD_VS = `#version 300 es
    layout(location = 0) in vec2 p;
    void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
  const FADE_FS = `#version 300 es
    precision mediump float;
    uniform float uFade;
    out vec4 o;
    void main() { o = vec4(0.0, 0.0, 0.0, uFade); }`;
  const COPY_FS = `#version 300 es
    precision mediump float;
    uniform sampler2D uSrc;
    uniform vec2 uRes;
    uniform float uGain;
    out vec4 o;
    void main() { o = vec4(texture(uSrc, gl_FragCoord.xy / uRes).rgb * uGain, 1.0); }`;
  const BRIGHT_FS = `#version 300 es
    precision mediump float;
    uniform sampler2D uScene;
    uniform vec2 uRes;
    out vec4 o;
    void main() {
      vec2 uv = gl_FragCoord.xy / uRes, t = 0.25 / uRes;
      vec3 c = (texture(uScene, uv + vec2(-t.x, -t.y)).rgb + texture(uScene, uv + vec2(t.x, -t.y)).rgb +
                texture(uScene, uv + vec2(-t.x, t.y)).rgb + texture(uScene, uv + vec2(t.x, t.y)).rgb) * 0.25;
      float l = max(c.r, max(c.g, c.b));
      o = vec4(c * smoothstep(0.22, 0.75, l), 1.0);
    }`;
  const BLUR_FS = `#version 300 es
    precision mediump float;
    uniform sampler2D uSrc;
    uniform vec2 uRes, uDir;
    out vec4 o;
    void main() {
      vec2 uv = gl_FragCoord.xy / uRes, d = uDir / uRes;
      vec3 c = texture(uSrc, uv).rgb * 0.227;
      c += (texture(uSrc, uv + d * 1.385).rgb + texture(uSrc, uv - d * 1.385).rgb) * 0.316;
      c += (texture(uSrc, uv + d * 3.231).rgb + texture(uSrc, uv - d * 3.231).rgb) * 0.070;
      o = vec4(c, 1.0);
    }`;
  const POST_FS = `#version 300 es
    precision highp float;
    uniform sampler2D uScene, uBloom;
    uniform vec2 uRes;
    uniform float uBloomK;
    out vec4 o;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;
      vec3 col = texture(uScene, uv).rgb + texture(uBloom, uv).rgb * uBloomK;
      vec2 v = uv - 0.5;
      col *= 1.0 - dot(v, v) * 0.55;                                  // soft vignette
      col += (hash(floor(gl_FragCoord.xy)) - 0.5) * 0.018;            // fixed grain, also hides banding
      col = col / (1.0 + max(col.r, max(col.g, col.b)) * 0.15);       // gentle roll-off for piled-up light
      o = vec4(col, 1.0);
    }`;

  // Growable instance lists.
  function Lines() { this.data = new Float32Array(LF * 1024); this.n = 0; }
  Lines.prototype.reset = function () { this.n = 0; };
  // A glowing segment from (ax, ay) to (bx, by): half-width w, halo radius glow, colour [r, g, b], alpha a.
  // swayA / swayB: how far each end moves in the wind (plants); phase; twinkle (0 = steady).
  Lines.prototype.add = function (ax, ay, bx, by, w, glow, col, a, swayA, swayB, phase, twinkle) {
    if ((this.n + 1) * LF > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    const d = this.data, o = this.n * LF;
    d[o] = ax; d[o + 1] = ay; d[o + 2] = bx; d[o + 3] = by;
    d[o + 4] = w; d[o + 5] = glow; d[o + 6] = swayA || 0; d[o + 7] = swayB || 0;
    d[o + 8] = col[0]; d[o + 9] = col[1]; d[o + 10] = col[2]; d[o + 11] = a;
    d[o + 12] = phase || 0; d[o + 13] = twinkle || 0; d[o + 14] = 0; d[o + 15] = 0;
    this.n++;
  };
  Lines.prototype.dot = function (x, y, r, glow, col, a, twinkle, phase) { this.add(x, y, x, y, r, glow, col, a, 0, 0, phase || 0, twinkle || 0); };
  // A polyline through pts [{x, y}], colour fading from colA to colB along it.
  Lines.prototype.path = function (pts, w, glow, colA, colB, a) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const c = colB ? HS.mixc(colA, colB, (i + 0.5) / (pts.length - 1)) : colA;
      this.add(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, w, glow, c, a);
    }
  };
  Lines.prototype.circle = function (x, y, r, w, glow, col, a, seg) {
    seg = seg || Math.max(12, Math.round(r / 3));
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg * 6.2832, t1 = (i + 1) / seg * 6.2832;
      this.add(x + Math.cos(t0) * r, y + Math.sin(t0) * r, x + Math.cos(t1) * r, y + Math.sin(t1) * r, w, glow, col, a);
    }
  };
  function Glyphs() { this.data = new Float32Array(GF * 512); this.n = 0; }
  Glyphs.prototype.reset = function () { this.n = 0; };
  Glyphs.prototype.add = function (ch, x, y, size, col, a, twinkle, phase, rot) {
    if ((this.n + 1) * GF > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    const d = this.data, o = this.n * GF;
    d[o] = x; d[o + 1] = y; d[o + 2] = size; d[o + 3] = typeof ch === 'number' ? ch : HS.glyph(ch);
    d[o + 4] = col[0]; d[o + 5] = col[1]; d[o + 6] = col[2]; d[o + 7] = a;
    d[o + 8] = phase || 0; d[o + 9] = twinkle || 0; d[o + 10] = rot || 0; d[o + 11] = 0;
    this.n++;
  };
  // A line of text starting at (x, y), monospace.
  Glyphs.prototype.text = function (s, x, y, size, col, a) {
    for (let i = 0; i < s.length; i++) if (s[i] !== ' ') this.add(s[i], x + i * size * 0.6, y, size, col, a);
  };

  HS.Renderer = function (canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true,
      desynchronized: true, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl; this.canvas = canvas;
    const uniforms = (prog, names) => { const u = {}; for (const n of names) u[n] = gl.getUniformLocation(prog, n); return u; };

    const quadVao = gl.createVertexArray();
    gl.bindVertexArray(quadVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.ground = new HS.Ground(gl, quadVao);

    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    function instanced(floats) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, cb);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (let i = 0; i < floats / 4; i++) {
        gl.enableVertexAttribArray(1 + i);
        gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, floats * 4, i * 16);
        gl.vertexAttribDivisor(1 + i, 1);
      }
      gl.bindVertexArray(null);
      return { vao, buf, size: 0, n: 0, floats };
    }
    const G = { still: instanced(LF), stillGlyphs: instanced(GF), moving: instanced(LF), movingGlyphs: instanced(GF), hud: instanced(GF) };

    const lineProg = HS.glProgram(gl, LINE_VS, LINE_FS), lU = uniforms(lineProg, ['uRes', 'uTime']);
    const glyphProg = HS.glProgram(gl, GLYPH_VS, GLYPH_FS), gU = uniforms(glyphProg, ['uRes', 'uTime', 'uCells']);
    gl.useProgram(glyphProg);
    gl.uniform1i(gl.getUniformLocation(glyphProg, 'uAtlas'), 7);
    gl.uniform2f(gU.uCells, HS.GLYPH_COLS, HS.GLYPH_ROWS);
    const atlas = gl.createTexture();
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, HS.buildGlyphAtlas());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const fadeProg = HS.glProgram(gl, QUAD_VS, FADE_FS), fU = uniforms(fadeProg, ['uFade']);
    const copyProg = HS.glProgram(gl, QUAD_VS, COPY_FS), cU = uniforms(copyProg, ['uSrc', 'uRes', 'uGain']);
    const brightProg = HS.glProgram(gl, QUAD_VS, BRIGHT_FS), bU = uniforms(brightProg, ['uRes']);
    gl.useProgram(brightProg); gl.uniform1i(gl.getUniformLocation(brightProg, 'uScene'), 8);
    const blurProg = HS.glProgram(gl, QUAD_VS, BLUR_FS), blU = uniforms(blurProg, ['uRes', 'uDir', 'uSrc']);
    const postProg = HS.glProgram(gl, QUAD_VS, POST_FS), pU = uniforms(postProg, ['uRes', 'uBloomK']);
    gl.useProgram(postProg);
    gl.uniform1i(gl.getUniformLocation(postProg, 'uScene'), 8);
    gl.uniform1i(gl.getUniformLocation(postProg, 'uBloom'), 12);

    // Off-screen pictures. Texture units: 8 frame, 9 trails, 10 ground, 12 + 13 bloom.
    let W = 0, H = 0;
    const T = this.targets = {};
    function target(name, unit, w, h) {
      if (T[name]) { gl.deleteTexture(T[name].tex); gl.deleteFramebuffer(T[name].fb); }
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      T[name] = { tex, fb, w, h, unit };
    }
    this.resize = function (w, h) {
      if (w === W && h === H) return;
      W = canvas.width = w; H = canvas.height = h;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      target('scene', 8, W, H);
      target('trail', 9, W, H);
      target('ground', 10, W, H);
      target('bloomA', 12, Math.ceil(W / 4), Math.ceil(H / 4));
      target('bloomB', 13, Math.ceil(W / 4), Math.ceil(H / 4));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.groundDirty = true;
    };

    this.still = new Lines();          // flora and other linework that only changes with the layout
    this.stillGlyphs = new Glyphs();   // stars and dust
    this.moving = new Lines();         // creatures, sparks, rings: redrawn every frame, leave trails
    this.movingGlyphs = new Glyphs();
    this.hud = new Glyphs();           // the status line, no trail
    this.stillDirty = true;

    function upload(gpu, batch, usage) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buf);
      const bytes = batch.n * gpu.floats * 4;
      if (bytes > gpu.size) { gpu.size = batch.data.byteLength; gl.bufferData(gl.ARRAY_BUFFER, gpu.size, usage); }
      if (batch.n) gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, batch.n * gpu.floats);
      gpu.n = batch.n;
    }
    function draw(gpu, glyphs, time) {
      if (!gpu.n) return;
      const prog = glyphs ? glyphProg : lineProg, u = glyphs ? gU : lU;
      gl.useProgram(prog);
      gl.bindVertexArray(gpu.vao);
      gl.uniform2f(u.uRes, W, H);
      gl.uniform1f(u.uTime, time);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gpu.n);
    }
    function fullscreen(prog, t) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
      gl.viewport(0, 0, t ? t.w : W, t ? t.h : H);
      gl.useProgram(prog);
      gl.bindVertexArray(quadVao);
    }

    let frameNo = 0;
    // Draw one frame. full = refresh everything now (a single frame while paused).
    // trailFade: how much of the old trails survives this frame (0 = none).
    this.render = function (world, time, full, trailFade) {
      frameNo++;
      if (this.groundDirty || world.dirty) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.ground.fb);
        gl.disable(gl.BLEND);
        this.ground.draw(world, W, H);
        this.groundDirty = false;
      }
      if (this.stillDirty) { upload(G.still, this.still, gl.STATIC_DRAW); upload(G.stillGlyphs, this.stillGlyphs, gl.STATIC_DRAW); this.stillDirty = false; }
      upload(G.moving, this.moving, gl.DYNAMIC_DRAW);
      upload(G.movingGlyphs, this.movingGlyphs, gl.DYNAMIC_DRAW);
      upload(G.hud, this.hud, gl.DYNAMIC_DRAW);

      // 1. trails: fade what is there, then add this frame's moving things
      gl.enable(gl.BLEND);
      fullscreen(fadeProg, T.trail);
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(fU.uFade, full ? 1 : 1 - trailFade);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.blendFunc(gl.ONE, gl.ONE);
      draw(G.moving, false, time);
      draw(G.movingGlyphs, true, time);

      // 2. the frame: ground, still layer, trails, status line
      gl.disable(gl.BLEND);
      fullscreen(copyProg, T.scene);
      gl.uniform1i(cU.uSrc, 10); gl.uniform2f(cU.uRes, W, H); gl.uniform1f(cU.uGain, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      draw(G.still, false, time);
      draw(G.stillGlyphs, true, time);
      fullscreen(copyProg, T.scene);
      gl.uniform1i(cU.uSrc, 9); gl.uniform1f(cU.uGain, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      draw(G.hud, true, time);
      gl.disable(gl.BLEND);

      // 3. bloom, every second frame
      if (full || frameNo % 2 === 0) {
        fullscreen(brightProg, T.bloomA);
        gl.uniform2f(bU.uRes, T.bloomA.w, T.bloomA.h);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        fullscreen(blurProg, T.bloomB);
        gl.uniform2f(blU.uRes, T.bloomB.w, T.bloomB.h); gl.uniform2f(blU.uDir, 1.6, 0); gl.uniform1i(blU.uSrc, 12);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        fullscreen(blurProg, T.bloomA);
        gl.uniform2f(blU.uDir, 0, 1.6); gl.uniform1i(blU.uSrc, 13);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      fullscreen(postProg, null);
      gl.uniform2f(pU.uRes, W, H);
      gl.uniform1f(pU.uBloomK, HS.pal.bloom * 0.85);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  };
})(window.HS);
