// One WebGL2 renderer for the whole picture.
//
// Every frame:
//   1. the ground is copied in from its own off-screen picture (repainted only while it morphs),
//   2. shadows: every standing thing's own silhouette, blurred and pushed away from the light
//      (which comes from the top-left) by its height, is gathered into a half-size shadow picture
//      and laid over the ground in one go, so overlapping shadows never double up,
//   3. every standing thing (buildings, trees, props, villagers, smoke, birds) is drawn on top as
//      textured rectangles cut from one big sprite sheet ("atlas"), all in a single draw call,
//   4. a finishing pass over the whole frame: drifting cloud shadows, a soft bloom on the
//      highlights, the time-of-day colour grade, and a faint paper grain,
//   5. night lights are added last, so they stay warm however dark the night grade gets.
// Keeping it to one canvas and a handful of draw calls is what keeps the processor cost low.
(function (HS) {
  const FLOATS = 20;   // per sprite instance: rect(4) uv(4) colour(4) pivot+rotation+sway(4) misc(4)
  const SHADOW_DIR = [0.9, 0.62];   // shadow offset per pixel of height (light from the top-left)

  const SPRITE_VS = `#version 300 es
    layout(location = 0) in vec2 aCorner;
    layout(location = 1) in vec4 iRect;    // x, y, w, h in pixels (before rotation)
    layout(location = 2) in vec4 iUV;      // u0, v0, u1, v1 in the atlas
    layout(location = 3) in vec4 iColor;   // multiplies the sprite (rgb) and its opacity (a)
    layout(location = 4) in vec4 iPivot;   // foot x, y; rotation about it; sway at the top (px)
    layout(location = 5) in vec4 iMisc;    // sway phase; height it stands (0 = casts no shadow); height above the ground
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uShadow;                 // 1 when drawing shadows instead of the things themselves
    uniform float uFiller;                 // 1 for the code-drawn filler: misc.z = grow (1) / shrink (-1), misc.w = when
    uniform vec2 uShadowDir;
    out vec2 vUV;
    out vec4 vColor;
    void main() {
      vec2 p = iRect.xy + aCorner * iRect.zw;
      float h = 1.0 - aCorner.y;
      p.x += (sin(uTime * 1.3 + iMisc.x) * 0.75 + sin(uTime * 2.7 + iMisc.x * 1.9) * 0.25) * iPivot.w * h * h;
      float c = cos(iPivot.z), s = sin(iPivot.z);
      vec2 d = p - iPivot.xy;
      p = iPivot.xy + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
      float lift = iMisc.z, grow = 1.0;
      if (uFiller > 0.5) {
        float t = clamp((uTime - iMisc.w) / 0.7, 0.0, 1.0);
        t = t * t * (3.0 - 2.0 * t);
        grow = iMisc.z > 0.5 ? t : (iMisc.z < -0.5 ? 1.0 - t : 1.0);
        if (grow < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        p = iPivot.xy + (p - iPivot.xy) * grow;
        lift = 0.0;
      }
      if (uShadow > 0.5) {
        if (iMisc.y <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        p += uShadowDir * (iMisc.y + lift) * grow;
      }
      vUV = mix(iUV.xy, iUV.zw, aCorner);
      vColor = iColor;
      gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
    }`;
  const SPRITE_FS = `#version 300 es
    precision mediump float;
    uniform sampler2D uAtlas;
    uniform highp float uShadow;
    in vec2 vUV;
    in vec4 vColor;
    out vec4 o;
    void main() {
      if (uShadow > 0.5) {
        // a lower-detail level of the sprite sheet is a cheap blur of the silhouette
        float a = texture(uAtlas, vUV, 2.2).a * vColor.a;
        o = vec4(a, a, a, a);
        return;
      }
      vec4 t = texture(uAtlas, vUV);
      o = vec4(t.rgb * vColor.rgb, t.a) * vColor.a;
    }`;

  const QUAD_VS = `#version 300 es
    layout(location = 0) in vec2 p;
    void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
  // Lays the shadow picture over the ground: the frame is multiplied by a cool shade.
  const SHADE_FS = `#version 300 es
    precision mediump float;
    uniform sampler2D uShadowTex;
    uniform vec2 uRes;
    out vec4 o;
    void main() {
      float s = texture(uShadowTex, gl_FragCoord.xy / uRes).r;
      o = vec4(mix(vec3(1.0), vec3(0.40, 0.47, 0.66), s * 0.72), 1.0);
    }`;
  // Bloom, step 1: keep only the bright parts of the frame, at a quarter of the size.
  const BRIGHT_FS = `#version 300 es
    precision mediump float;
    uniform sampler2D uScene;
    uniform vec2 uRes;       // size of the small picture
    uniform float uThreshold;
    out vec4 o;
    void main() {
      vec2 uv = gl_FragCoord.xy / uRes, t = 0.5 / uRes;
      vec3 c = (texture(uScene, uv + vec2(-t.x, -t.y) * 0.5).rgb + texture(uScene, uv + vec2(t.x, -t.y) * 0.5).rgb +
                texture(uScene, uv + vec2(-t.x, t.y) * 0.5).rgb + texture(uScene, uv + vec2(t.x, t.y) * 0.5).rgb) * 0.25;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      o = vec4(c * smoothstep(uThreshold, uThreshold + 0.25, l), 1.0);
    }`;
  // Bloom, step 2: blur it, once across and once down.
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
    uniform sampler2D uScene, uCloud, uBloom;
    uniform vec2 uRes;
    uniform float uTime;
    uniform vec3 uGain, uLift;     // time-of-day grade: highlights are multiplied by gain, shadows lifted toward lift
    uniform vec3 uGrade;           // saturation, contrast (S-curve amount), bloom strength
    out vec4 o;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;
      vec3 col = texture(uScene, uv).rgb;
      vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
      // cloud shadows: two layers of soft noise drifting with the wind
      vec2 wind = vec2(9.0, 3.5) * uTime;
      float c = texture(uCloud, (px + wind) / 1300.0).r * 0.68 + texture(uCloud, (px + wind * 1.25) / 520.0 + 0.31).r * 0.32;
      float cloud = smoothstep(0.46, 0.62, c);
      col = mix(col, col * vec3(0.68, 0.74, 0.90), cloud * 0.42);
      // grade
      col += texture(uBloom, uv).rgb * uGrade.z;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uGrade.x);
      col = clamp(col, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * col), uGrade.y);
      col = col * uGain + uLift * (1.0 - col);
      // paper: a fixed fine grain plus faint large blotches, like pigment settling on rough paper
      float grain = hash(floor(px)) - 0.5;
      float paper = texture(uCloud, px / 340.0 + 0.71).r - 0.5;
      col *= 1.0 + grain * 0.035 + paper * 0.05;
      o = vec4(col, 1.0);
    }`;

  // A seamless 256x256 noise picture for the clouds (value noise that wraps at the edges).
  function cloudPixels() {
    const N = 256, out = new Uint8Array(N * N);
    const lattice = (p) => { const g = new Float32Array(p * p); const r = HS.rng(p * 7 + 3); for (let i = 0; i < g.length; i++) g[i] = r(); return g; };
    const octaves = [[4, 0.5], [8, 0.27], [16, 0.15], [32, 0.08]].map(([p, a]) => ({ p, a, g: lattice(p) }));
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0;
      for (const o of octaves) {
        const fx = x / N * o.p, fy = y / N * o.p, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), p = o.p, g = o.g;
        const a = g[(y0 % p) * p + x0 % p], b = g[(y0 % p) * p + (x0 + 1) % p], c = g[((y0 + 1) % p) * p + x0 % p], d = g[((y0 + 1) % p) * p + (x0 + 1) % p];
        v += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * o.a;
      }
      out[y * N + x] = Math.round(HS.clamp(v, 0, 1) * 255);
    }
    return out;
  }

  // A growable list of sprite instances.
  function Batch() { this.data = new Float32Array(FLOATS * 512); this.n = 0; }
  Batch.prototype.reset = function () { this.n = 0; };
  // Sprite sp with its foot at (x, y), scaled by sx, sy. flip mirrors it. Optional colour multiply,
  // rotation about the foot, sway (pixels the top swings in the wind) with its phase, the height
  // it stands (for its shadow; 0 = no shadow) and how high above the ground it is (birds).
  Batch.prototype.add = function (sp, x, y, sx, sy, flip, r, g, b, a, rot, sway, phase, cast, lift) {
    if (!sp || !sp.uv) return;
    if ((this.n + 1) * FLOATS > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    const d = this.data, o = this.n * FLOATS, uv = sp.uv;
    const w = sp.w * sx, h = sp.h * sy;
    d[o] = flip ? x - (sp.w - sp.ax) * sx : x - sp.ax * sx; d[o + 1] = y - sp.ay * sy; d[o + 2] = w; d[o + 3] = h;
    d[o + 4] = flip ? uv[2] : uv[0]; d[o + 5] = uv[1]; d[o + 6] = flip ? uv[0] : uv[2]; d[o + 7] = uv[3];
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
    d[o + 12] = x; d[o + 13] = y; d[o + 14] = rot || 0; d[o + 15] = sway || 0;
    d[o + 16] = phase || 0; d[o + 17] = (cast || 0) * Math.abs(sy); d[o + 18] = lift || 0; d[o + 19] = 0;
    this.n++;
  };
  Batch.prototype.sprite = function (sp, x, y, scale, cast, sway, phase) {
    this.add(sp, x, y, scale, scale, false, 1, 1, 1, 1, 0, sway || 0, phase || 0, cast || 0, 0);
  };

  HS.Renderer = function (canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl; this.canvas = canvas;
    const uniforms = (prog, names) => { const u = {}; for (const n of names) u[n] = gl.getUniformLocation(prog, n); return u; };

    // full-screen rectangle, shared by the ground and the full-screen passes
    const quadVao = gl.createVertexArray();
    gl.bindVertexArray(quadVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.ground = new HS.Ground(gl, quadVao);

    // sprites (and their shadows)
    const sprog = HS.glProgram(gl, SPRITE_VS, SPRITE_FS);
    const sU = uniforms(sprog, ['uRes', 'uTime', 'uShadow', 'uFiller', 'uShadowDir']);
    gl.useProgram(sprog);
    gl.uniform1i(gl.getUniformLocation(sprog, 'uAtlas'), 7);
    gl.uniform2f(sU.uShadowDir, SHADOW_DIR[0], SHADOW_DIR[1]);
    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    // one instance buffer for the things redrawn every frame, one for the filler (changes rarely)
    function instanced() {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, cb);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (let i = 0; i < 5; i++) {
        gl.enableVertexAttribArray(1 + i);
        gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
        gl.vertexAttribDivisor(1 + i, 1);
      }
      gl.bindVertexArray(null);
      return { vao, buf, size: 0, n: 0 };
    }
    const sceneGpu = instanced(), fillerGpu = instanced(), lightsGpu = instanced();

    // full-screen passes
    const shadeProg = HS.glProgram(gl, QUAD_VS, SHADE_FS), shadeU = uniforms(shadeProg, ['uRes']);
    gl.useProgram(shadeProg); gl.uniform1i(gl.getUniformLocation(shadeProg, 'uShadowTex'), 11);
    const brightProg = HS.glProgram(gl, QUAD_VS, BRIGHT_FS), brightU = uniforms(brightProg, ['uRes', 'uThreshold']);
    gl.useProgram(brightProg); gl.uniform1i(gl.getUniformLocation(brightProg, 'uScene'), 8);
    const blurProg = HS.glProgram(gl, QUAD_VS, BLUR_FS), blurU = uniforms(blurProg, ['uRes', 'uDir', 'uSrc']);
    const pprog = HS.glProgram(gl, QUAD_VS, POST_FS), pU = uniforms(pprog, ['uRes', 'uTime', 'uGain', 'uLift', 'uGrade']);
    gl.useProgram(pprog);
    gl.uniform1i(gl.getUniformLocation(pprog, 'uScene'), 8);
    gl.uniform1i(gl.getUniformLocation(pprog, 'uCloud'), 9);
    gl.uniform1i(gl.getUniformLocation(pprog, 'uBloom'), 12);
    const cloud = gl.createTexture();
    gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, cloud);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 256, 0, gl.RED, gl.UNSIGNED_BYTE, cloudPixels());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    // Off-screen pictures. Texture units: 8 frame, 10 ground, 11 shadows, 12 + 13 bloom.
    let W = 0, H = 0;
    const T = this.targets = {};
    function target(name, unit, w, h, filter) {
      if (T[name]) { gl.deleteTexture(T[name].tex); gl.deleteFramebuffer(T[name].fb); }
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      T[name] = { tex, fb, w, h, unit };
    }
    this.resize = function (w, h) {
      if (w === W && h === H) return;
      W = canvas.width = w; H = canvas.height = h;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      target('scene', 8, W, H, gl.LINEAR);
      target('ground', 10, W, H, gl.NEAREST);
      target('shadow', 11, Math.ceil(W / 2), Math.ceil(H / 2), gl.LINEAR);
      target('bloomA', 12, Math.ceil(W / 4), Math.ceil(H / 4), gl.LINEAR);
      target('bloomB', 13, Math.ceil(W / 4), Math.ceil(H / 4), gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.groundDirty = true;
    };

    // --- the sprite sheet ---------------------------------------------------------------------
    // Every sprite's little canvas is packed into one big texture (rows of sprites, tallest first),
    // and each sprite remembers where it landed (sp.uv). The gaps are wide enough that the blurred
    // lower-detail levels used for shadows do not pick up the neighbours.
    const atlasTex = gl.createTexture();
    this.setSprites = function (list) {
      const uniq = [...new Set(list.filter((s) => s && s.canvas))];
      const AW = 2048, pad = 12;
      uniq.sort((a, b) => b.canvas.height - a.canvas.height);
      let x = pad, y = pad, rowH = 0;
      for (const sp of uniq) {
        const w = sp.canvas.width, h = sp.canvas.height;
        if (x + w + pad > AW) { x = pad; y += rowH + pad; rowH = 0; }
        sp._ax = x; sp._ay = y; x += w + pad; rowH = Math.max(rowH, h);
      }
      const AH = y + rowH + pad;
      const c = document.createElement('canvas'); c.width = AW; c.height = AH;
      const g = c.getContext('2d');
      for (const sp of uniq) {
        g.drawImage(sp.canvas, sp._ax, sp._ay);
        sp.uv = [sp._ax / AW, sp._ay / AH, (sp._ax + sp.canvas.width) / AW, (sp._ay + sp.canvas.height) / AH];
      }
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.atlasSize = [AW, AH];
    };

    this.scene = new Batch();   // everything standing, in depth order
    this.lights = new Batch();  // night lights, added on top of the finished frame
    this.filler = new Batch();  // code-drawn filler; set fillerDirty after changing it

    function upload(gpu, batch, usage) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buf);
      const bytes = batch.n * FLOATS * 4;
      if (bytes > gpu.size) { gpu.size = batch.data.byteLength; gl.bufferData(gl.ARRAY_BUFFER, gpu.size, usage); }
      if (batch.n) gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, batch.n * FLOATS);
      gpu.n = batch.n;
    }
    function drawGpu(gpu, time, shadow, filler) {
      if (!gpu.n) return;
      gl.useProgram(sprog);
      gl.bindVertexArray(gpu.vao);
      gl.uniform2f(sU.uRes, W, H);
      gl.uniform1f(sU.uTime, time);
      gl.uniform1f(sU.uShadow, shadow ? 1 : 0);
      gl.uniform1f(sU.uFiller, filler ? 1 : 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gpu.n);
    }
    function fullscreen(prog, t) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
      gl.viewport(0, 0, t ? t.w : W, t ? t.h : H);
      gl.useProgram(prog);
      gl.bindVertexArray(quadVao);
    }

    // The time-of-day grade, set by main.js: gain, lift, [saturation, contrast, bloom].
    this.grade = { gain: [1, 1, 1], lift: [0, 0, 0], look: [1, 0.15, 0.3], threshold: 0.72 };

    // Draw one frame. Fill this.scene and this.lights first.
    // Shadows and bloom change slowly, and both pictures are kept between frames, so they are
    // refreshed only every second and every fourth frame (always when asked to, with full = true).
    let frameNo = 0;
    this.render = function (world, time, full) {
      frameNo++;
      const doShadows = full || frameNo % 2 === 0 || this.fillerDirty, doBloom = full || frameNo % 4 === 1;
      if (this.groundDirty || world.dirty) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.ground.fb);
        gl.disable(gl.BLEND);
        this.ground.draw(world, W, H);
        this.groundDirty = false;
      }
      // the frame starts as a copy of the ground
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.ground.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.scene.fb);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);

      upload(sceneGpu, this.scene, gl.DYNAMIC_DRAW);
      if (this.fillerDirty) { upload(fillerGpu, this.filler, gl.STATIC_DRAW); this.fillerDirty = false; }
      // shadows: gathered with "keep the darkest", then multiplied over the ground once
      gl.enable(gl.BLEND);
      if (doShadows) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.shadow.fb);
        gl.viewport(0, 0, T.shadow.w, T.shadow.h);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.blendEquation(gl.MAX);
        drawGpu(fillerGpu, time, true, true);
        drawGpu(sceneGpu, time, true, false);
        gl.blendEquation(gl.FUNC_ADD);
      }
      fullscreen(shadeProg, T.scene);
      gl.uniform2f(shadeU.uRes, W, H);
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // the things themselves
      gl.viewport(0, 0, W, H);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      drawGpu(fillerGpu, time, false, true);
      drawGpu(sceneGpu, time, false, false);
      gl.disable(gl.BLEND);

      // bloom: bright parts at a quarter size, blurred across then down
      const g = this.grade;
      if (doBloom) {
        fullscreen(brightProg, T.bloomA);
        gl.uniform2f(brightU.uRes, T.bloomA.w, T.bloomA.h);
        gl.uniform1f(brightU.uThreshold, g.threshold);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        fullscreen(blurProg, T.bloomB);
        gl.uniform2f(blurU.uRes, T.bloomB.w, T.bloomB.h); gl.uniform2f(blurU.uDir, 1.5, 0); gl.uniform1i(blurU.uSrc, 12);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        fullscreen(blurProg, T.bloomA);
        gl.uniform2f(blurU.uDir, 0, 1.5); gl.uniform1i(blurU.uSrc, 13);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      // finishing pass onto the screen
      fullscreen(pprog, null);
      gl.uniform2f(pU.uRes, W, H);
      gl.uniform1f(pU.uTime, time);
      gl.uniform3fv(pU.uGain, g.gain);
      gl.uniform3fv(pU.uLift, g.lift);
      gl.uniform3fv(pU.uGrade, g.look);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (this.lights.n) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        upload(lightsGpu, this.lights, gl.DYNAMIC_DRAW);
        drawGpu(lightsGpu, time, false, false);
        gl.disable(gl.BLEND);
      }
    };
  };
})(window.HS);
