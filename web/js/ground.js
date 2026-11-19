// The ground (grass, cobblestone plazas, dirt paths, district lawns) is painted by the graphics
// card from the land field (see field.js). The field arrives as two small float textures, the
// previous one and the new one, and the shader morphs between them itself, rippling out from
// where an icon was dropped.
(function (HS) {
  const VERT = `#version 300 es
    in vec2 p;
    void main() { gl_Position = vec4(p, 0.0, 1.0); }
  `;

  const FRAG = `#version 300 es
    precision highp float;
    uniform vec2 uRes;       // screen size in pixels
    uniform vec2 uFieldPx;   // field size in pixels (texels * 4)
    uniform sampler2D uOld, uNew;
    uniform vec3 uDrop;      // where the change started (x, y), and 1 if it ripples from there
    uniform float uT;        // seconds since the change
    uniform float uMorph;    // seconds each spot takes to change
    uniform vec4 uGrid;      // desktop icon grid: origin x, origin y, cell width, cell height
    uniform vec3 uTint;      // time-of-day colour everything is multiplied by
    uniform sampler2D uGrass, uCobble, uDirt, uLawn;   // painted ground textures
    uniform float uUseTex;   // 1 once those textures have loaded
    out vec4 outColor;

    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { return noise(p) * 0.55 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 + 9.1) * 0.15; }

    // Cobblestones: x = distance to the nearest stone edge, y = a random value per stone.
    vec2 stones(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      float d1 = 9.0, d2 = 9.0, id = 0.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(hash(i + g), hash(i + g + 17.3)) * 0.8 + 0.1;
        float d = length(g + o - f);
        if (d < d1) { d2 = d1; d1 = d; id = hash(i + g + 5.1); } else if (d < d2) { d2 = d; }
      }
      return vec2(d2 - d1, id);
    }

    // The land field here, part way between the old and the new one.
    vec4 field(vec2 px) {
      vec2 uv = px / uFieldPx;
      vec4 a = texture(uOld, uv), b = texture(uNew, uv);
      float delay = uDrop.z > 0.5 ? min(0.9, length(px - uDrop.xy) / 900.0) : 0.0;
      float t = smoothstep(0.0, 1.0, clamp((uT - delay) / uMorph, 0.0, 1.0));
      return mix(a, b, t);
    }

    void main() {
      vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
      vec4 f = field(px);
      float village = f.a;

      // grass, with big soft patches and fine speckle
      float big = fbm(px / 130.0);
      float fine = noise(px / 5.0);
      vec3 grass = mix(vec3(0.36, 0.56, 0.27), vec3(0.50, 0.68, 0.33), big);
      grass = mix(grass, vec3(0.56, 0.70, 0.36), village * 0.35);
      grass *= 0.94 + fine * 0.10;

      // edges get a hand-drawn wobble from noise
      float wob = fbm(px / 16.0) - 0.5;
      float sdf = f.r + wob * 5.0;
      float clear = smoothstep(1.2, -1.2, sdf);
      // near icons the clearing is a plaza, further out (along paths) it is a dirt track
      float plazaness = 1.0 - smoothstep(30.0, 46.0, f.g + wob * 14.0);

      vec3 dirt = mix(vec3(0.74, 0.62, 0.43), vec3(0.82, 0.72, 0.52), fbm(px / 22.0 + 5.0));
      dirt *= 0.95 + fine * 0.08;

      // plaza: cobblestone in the village, flowery meadow out in the forest
      vec2 st = stones(px / 13.0);
      vec3 stone = mix(vec3(0.74, 0.70, 0.62), vec3(0.85, 0.81, 0.72), st.y);
      stone *= 0.96 + fine * 0.06;
      stone = mix(vec3(0.55, 0.52, 0.46), stone, smoothstep(0.03, 0.12, st.x));
      vec3 meadow = mix(vec3(0.62, 0.76, 0.40), vec3(0.72, 0.82, 0.46), fbm(px / 40.0 + 2.0));
      vec2 fc = floor(px / 9.0);
      float flower = step(0.93, hash(fc)) * step(length(fract(px / 9.0) - 0.5), 0.2);
      meadow = mix(meadow, mix(vec3(0.98, 0.95, 0.85), vec3(0.95, 0.62, 0.68), hash(fc + 3.0)), flower);
      vec3 tLawn = texture(uLawn, px / 240.0).rgb;
      if (uUseTex > 0.5) {
        grass = texture(uGrass, px / 180.0).rgb * (0.90 + big * 0.20);
        grass = mix(grass, grass * vec3(1.07, 1.04, 0.90), village * 0.35);
        dirt = texture(uDirt, px / 260.0).rgb;
        stone = texture(uCobble, px / 64.0).rgb;
        meadow = mix(tLawn * vec3(1.06, 1.05, 0.92), mix(vec3(0.98, 0.95, 0.85), vec3(0.95, 0.62, 0.68), hash(fc + 3.0)), flower);
      }
      vec3 plazaCol = mix(meadow, stone, smoothstep(0.40, 0.60, village + wob * 0.3));
      plazaCol = mix(dirt, plazaCol, plazaness);

      // district: a patchwork of lawn lots (one per icon slot) divided by cobbled lanes
      float district = smoothstep(1.5, -1.5, f.b + wob * 4.0);
      if (district > 0.0) {
        vec2 gp = px - uGrid.xy;
        vec2 cell = floor(gp / uGrid.zw), loc = gp - cell * uGrid.zw;
        float dx = min(loc.x, uGrid.z - loc.x), dy = min(loc.y, uGrid.w - loc.y);
        float lw = fbm(px / 9.0 + 4.0) * 5.0;
        float lane = max(1.0 - smoothstep(8.0, 11.0, dx + lw), 1.0 - smoothstep(5.0, 8.0, dy + lw));
        vec3 lawn = mix(vec3(0.47, 0.66, 0.33), vec3(0.58, 0.74, 0.39), fbm(px / 50.0 + 8.0));
        if (uUseTex > 0.5) lawn = tLawn;
        lawn *= 0.95 + hash(cell) * 0.10;                 // each lot a slightly different green
        lawn *= 0.96 + fine * 0.07;
        float edge = max(1.0 - smoothstep(9.0, 17.0, dx + lw), 1.0 - smoothstep(6.0, 13.0, dy + lw));
        lawn *= 1.0 - edge * 0.10;                        // lots darken a touch toward the lane
        float fl = step(0.965, hash(floor(px / 8.0) + 11.0)) * step(length(fract(px / 8.0) - 0.5), 0.22);
        lawn = mix(lawn, vec3(0.98, 0.95, 0.80), fl);
        plazaCol = mix(plazaCol, mix(lawn, stone, lane), district);
      }

      vec3 col = grass;
      // soft shadow in the grass just outside the clearing, so it looks slightly sunk in
      float rim = smoothstep(14.0, 0.0, sdf) * (1.0 - clear);
      col *= 1.0 - rim * 0.16;
      col = mix(col, plazaCol, clear);

      outColor = vec4(col * uTint, 1.0);
    }
  `;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  }

  HS.Ground = function (canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // the old and new field, on texture units 5 and 6
    function fieldTex(unit) {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    const texOld = fieldTex(5), texNew = fieldTex(6);
    gl.uniform1i(gl.getUniformLocation(prog, 'uOld'), 5);
    gl.uniform1i(gl.getUniformLocation(prog, 'uNew'), 6);
    gl.activeTexture(gl.TEXTURE0);

    const U = {};
    for (const n of ['uRes', 'uFieldPx', 'uDrop', 'uT', 'uMorph', 'uGrid', 'uTint']) U[n] = gl.getUniformLocation(prog, n);
    let uploaded = -1, uploadedField = null;

    // Load the four painted ground textures; calls done() when they are all in use.
    this.loadTextures = function (done) {
      const names = ['Grass', 'Cobble', 'Dirt', 'Lawn'];
      let left = names.length, failed = false;
      names.forEach((name, i) => {
        const img = new Image();
        img.onerror = () => { failed = true; if (--left === 0) done(false); };
        img.onload = () => {
          const t = gl.createTexture();
          gl.activeTexture(gl.TEXTURE1 + i); gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
          gl.uniform1i(gl.getUniformLocation(prog, 'u' + name), 1 + i);
          gl.activeTexture(gl.TEXTURE0);
          if (--left === 0) { if (!failed) gl.uniform1f(gl.getUniformLocation(prog, 'uUseTex'), 1); done(!failed); }
        };
        img.src = 'art/ground/' + name.toLowerCase() + '.png';
      });
    };

    // Redraw the ground. The field textures are re-sent only when the field itself changed.
    this.draw = function (world) {
      const f = world.field;
      if (f.version !== uploaded || f !== uploadedField) {
        uploaded = f.version; uploadedField = f;
        for (const [unit, tex, data] of [[5, texOld, f.old], [6, texNew, f.next]]) {
          gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, f.w, f.h, 0, gl.RGBA, gl.FLOAT, data);
        }
        gl.activeTexture(gl.TEXTURE0);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform2f(U.uFieldPx, f.w * f.res, f.h * f.res);
      gl.uniform3f(U.uDrop, f.drop ? f.drop.x : 0, f.drop ? f.drop.y : 0, f.drop ? 1 : 0);
      gl.uniform1f(U.uT, Math.min(f.t, 1e4));
      gl.uniform1f(U.uMorph, HS.MORPH);
      gl.uniform4f(U.uGrid, world.grid.ox, world.grid.oy, world.grid.cw, world.grid.ch);
      gl.uniform3f(U.uTint, HS.tint[0], HS.tint[1], HS.tint[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  };
})(window.HS);
