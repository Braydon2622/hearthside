// One WebGL2 renderer for the whole picture.
//
// Every frame:
//   1. the ground is copied in from its own off-screen picture (repainted only while it morphs),
//   2. every standing thing (buildings, trees, props, villagers, smoke, birds) is drawn on top as
//      textured rectangles cut from one big sprite sheet ("atlas"), all in a single draw call,
//   3. a finishing pass over the whole frame adds the drifting cloud shadows and the time of day,
//   4. night lights are added last, so they stay warm however dark the night grade gets.
// Keeping it to one canvas and a handful of draw calls is what keeps the processor cost low.
(function (HS) {
  const FLOATS = 20;   // per sprite instance: rect(4) uv(4) colour(4) pivot+rotation+sway(4) misc(4)

  const SPRITE_VS = `#version 300 es
    layout(location = 0) in vec2 aCorner;
    layout(location = 1) in vec4 iRect;    // x, y, w, h in pixels (before rotation)
    layout(location = 2) in vec4 iUV;      // u0, v0, u1, v1 in the atlas
    layout(location = 3) in vec4 iColor;   // multiplies the sprite (rgb) and its opacity (a)
    layout(location = 4) in vec4 iPivot;   // foot x, y; rotation about it; sway at the top (px)
    layout(location = 5) in vec4 iMisc;    // sway phase
    uniform vec2 uRes;
    uniform float uTime;
    out vec2 vUV;
    out vec4 vColor;
    void main() {
      vec2 p = iRect.xy + aCorner * iRect.zw;
      float h = 1.0 - aCorner.y;
      p.x += (sin(uTime * 1.3 + iMisc.x) * 0.75 + sin(uTime * 2.7 + iMisc.x * 1.9) * 0.25) * iPivot.w * h * h;
      float c = cos(iPivot.z), s = sin(iPivot.z);
      vec2 d = p - iPivot.xy;
      p = iPivot.xy + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
      vUV = mix(iUV.xy, iUV.zw, aCorner);
      vColor = iColor;
      gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
    }`;
  const SPRITE_FS = `#version 300 es
    precision mediump float;
    uniform sampler2D uAtlas;
    in vec2 vUV;
    in vec4 vColor;
    out vec4 o;
    void main() { vec4 t = texture(uAtlas, vUV); o = vec4(t.rgb * vColor.rgb, t.a) * vColor.a; }`;

  const POST_VS = `#version 300 es
    layout(location = 0) in vec2 p;
    void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
  const POST_FS = `#version 300 es
    precision highp float;
    uniform sampler2D uScene, uCloud;
    uniform vec2 uRes;
    uniform float uTime;
    uniform vec3 uTint;
    out vec4 o;
    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;
      vec3 col = texture(uScene, uv).rgb;
      vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
      // cloud shadows: two layers of soft noise drifting with the wind
      vec2 wind = vec2(9.0, 3.5) * uTime;
      float c = texture(uCloud, (px + wind) / 1300.0).r * 0.68 + texture(uCloud, (px + wind * 1.25) / 520.0 + 0.31).r * 0.32;
      float cloud = smoothstep(0.46, 0.62, c);
      col = mix(col, col * vec3(0.68, 0.74, 0.90), cloud * 0.42);
      o = vec4(col * uTint, 1.0);
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
  // rotation about the foot, and sway (pixels the top swings in the wind) with its phase.
  Batch.prototype.add = function (sp, x, y, sx, sy, flip, r, g, b, a, rot, sway, phase) {
    if (!sp || !sp.uv) return;
    if ((this.n + 1) * FLOATS > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    const d = this.data, o = this.n * FLOATS, uv = sp.uv;
    const w = sp.w * sx, h = sp.h * sy;
    d[o] = flip ? x - (sp.w - sp.ax) * sx : x - sp.ax * sx; d[o + 1] = y - sp.ay * sy; d[o + 2] = w; d[o + 3] = h;
    d[o + 4] = flip ? uv[2] : uv[0]; d[o + 5] = uv[1]; d[o + 6] = flip ? uv[0] : uv[2]; d[o + 7] = uv[3];
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
    d[o + 12] = x; d[o + 13] = y; d[o + 14] = rot || 0; d[o + 15] = sway || 0;
    d[o + 16] = phase || 0; d[o + 17] = 0; d[o + 18] = 0; d[o + 19] = 0;
    this.n++;
  };
  Batch.prototype.sprite = function (sp, x, y, scale) { this.add(sp, x, y, scale, scale, false, 1, 1, 1, 1, 0, 0, 0); };

  HS.Renderer = function (canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl; this.canvas = canvas;

    // full-screen rectangle, shared by the ground and the finishing pass
    const quadVao = gl.createVertexArray();
    gl.bindVertexArray(quadVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.ground = new HS.Ground(gl, quadVao);

    // sprites
    const sprog = HS.glProgram(gl, SPRITE_VS, SPRITE_FS);
    const sU = { uRes: gl.getUniformLocation(sprog, 'uRes'), uTime: gl.getUniformLocation(sprog, 'uTime') };
    gl.useProgram(sprog);
    gl.uniform1i(gl.getUniformLocation(sprog, 'uAtlas'), 7);
    const spriteVao = gl.createVertexArray();
    gl.bindVertexArray(spriteVao);
    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    for (let i = 0; i < 5; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindVertexArray(null);
    let ibSize = 0;

    // finishing pass
    const pprog = HS.glProgram(gl, POST_VS, POST_FS);
    const pU = {};
    for (const n of ['uRes', 'uTime', 'uTint']) pU[n] = gl.getUniformLocation(pprog, n);
    gl.useProgram(pprog);
    gl.uniform1i(gl.getUniformLocation(pprog, 'uScene'), 8);
    gl.uniform1i(gl.getUniformLocation(pprog, 'uCloud'), 9);
    const cloud = gl.createTexture();
    gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, cloud);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 256, 0, gl.RED, gl.UNSIGNED_BYTE, cloudPixels());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    // off-screen pictures: the ground (kept between frames) and the frame being built
    let W = 0, H = 0, groundFb = null, sceneFb = null, groundTex = null, sceneTex = null;
    function target(unit, old) {
      if (old) gl.deleteTexture(old);
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    function fbo(tex, old) {
      if (old) gl.deleteFramebuffer(old);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return f;
    }
    this.resize = function (w, h) {
      if (w === W && h === H) return;
      W = canvas.width = w; H = canvas.height = h;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      groundTex = target(10, groundTex); groundFb = fbo(groundTex, groundFb);
      sceneTex = target(8, sceneTex); sceneFb = fbo(sceneTex, sceneFb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.groundDirty = true;
    };

    // --- the sprite sheet ---------------------------------------------------------------------
    // Every sprite's little canvas is packed into one big texture (rows of sprites, tallest first),
    // and each sprite remembers where it landed (sp.uv).
    const atlasTex = gl.createTexture();
    this.setSprites = function (list) {
      const uniq = [...new Set(list.filter((s) => s && s.canvas))];
      const AW = 2048, pad = 4;
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

    function drawBatch(batch, time) {
      if (!batch.n) return;
      gl.useProgram(sprog);
      gl.bindVertexArray(spriteVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, ib);
      const bytes = batch.n * FLOATS * 4;
      if (bytes > ibSize) { ibSize = batch.data.byteLength; gl.bufferData(gl.ARRAY_BUFFER, ibSize, gl.DYNAMIC_DRAW); }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, batch.n * FLOATS);
      gl.uniform2f(sU.uRes, W, H);
      gl.uniform1f(sU.uTime, time);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.n);
    }

    // Draw one frame. Fill this.scene and this.lights first.
    this.render = function (world, time, tint) {
      if (this.groundDirty || world.dirty) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, groundFb);
        gl.disable(gl.BLEND);
        this.ground.draw(world, W, H);
        this.groundDirty = false;
      }
      // the frame starts as a copy of the ground
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, groundFb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sceneFb);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFb);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      drawBatch(this.scene, time);

      // finishing pass onto the screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.disable(gl.BLEND);
      gl.useProgram(pprog);
      gl.bindVertexArray(quadVao);
      gl.uniform2f(pU.uRes, W, H);
      gl.uniform1f(pU.uTime, time);
      gl.uniform3f(pU.uTint, tint[0], tint[1], tint[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (this.lights.n) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        drawBatch(this.lights, time);
        gl.disable(gl.BLEND);
      }
    };
  };
})(window.HS);
