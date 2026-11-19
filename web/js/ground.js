// The ground (grass, cobblestone plazas, dirt paths) is painted by the graphics card.
// The world hands it a tiny picture with one pixel per world cell, where
//   red   = how much this cell is plaza / clearing
//   green = how much this cell is path
//   blue  = how much this cell belongs to the village (vs. the forest)
// and the shader below turns that into textured, soft-edged ground for every screen pixel.
(function (HS) {
  const VERT = `
    attribute vec2 p;
    void main() { gl_Position = vec4(p, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;
    uniform vec2 uRes;      // screen size in pixels
    uniform vec2 uWorld;    // world size in pixels (cells * cell size)
    uniform sampler2D uField;
    uniform vec4 uGrid;     // desktop icon grid: origin x, origin y, cell width, cell height
    uniform vec3 uTint;     // time-of-day colour everything is multiplied by

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

    void main() {
      vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
      vec4 f = texture2D(uField, px / uWorld);
      float village = f.b;

      // grass, with big soft patches and fine speckle
      float big = fbm(px / 130.0);
      float fine = noise(px / 5.0);
      vec3 grass = mix(vec3(0.36, 0.56, 0.27), vec3(0.50, 0.68, 0.33), big);
      grass = mix(grass, vec3(0.56, 0.70, 0.36), village * 0.35);
      grass *= 0.94 + fine * 0.10;
      float tuft = step(0.86, hash(floor(px / 7.0))) * step(0.5, noise(px / 60.0));
      grass *= 1.0 - tuft * 0.10;

      // edges get a hand-drawn wobble from noise
      float wob = fbm(px / 16.0) - 0.5;
      float plazaE = f.r + wob * 0.20;
      float pathE = f.g + (fbm(px / 12.0 + 31.0) - 0.5) * 0.30;
      float plaza = smoothstep(0.47, 0.53, plazaE);
      float path = smoothstep(0.45, 0.52, pathE);

      // dirt path
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
      vec3 plazaCol = mix(meadow, stone, smoothstep(0.40, 0.60, village + wob * 0.3));

      // district: a patchwork of lawn lots (one per icon slot) divided by cobbled lanes
      float district = smoothstep(0.45, 0.55, f.a + wob * 0.15);
      if (district > 0.0) {
        vec2 gp = px - uGrid.xy;
        vec2 cell = floor(gp / uGrid.zw), loc = gp - cell * uGrid.zw;
        float dx = min(loc.x, uGrid.z - loc.x), dy = min(loc.y, uGrid.w - loc.y);
        float lw = fbm(px / 9.0 + 4.0) * 5.0;
        float lane = max(1.0 - smoothstep(8.0, 11.0, dx + lw), 1.0 - smoothstep(5.0, 8.0, dy + lw));
        vec3 lawn = mix(vec3(0.47, 0.66, 0.33), vec3(0.58, 0.74, 0.39), fbm(px / 50.0 + 8.0));
        lawn *= 0.95 + hash(cell) * 0.10;                 // each lot a slightly different green
        lawn *= 0.96 + fine * 0.07;
        float edge = max(1.0 - smoothstep(9.0, 17.0, dx + lw), 1.0 - smoothstep(6.0, 13.0, dy + lw));
        lawn *= 1.0 - edge * 0.10;                        // lots darken a touch toward the lane
        float fl = step(0.965, hash(floor(px / 8.0) + 11.0)) * step(length(fract(px / 8.0) - 0.5), 0.22);
        lawn = mix(lawn, vec3(0.98, 0.95, 0.80), fl);
        plazaCol = mix(plazaCol, mix(lawn, stone, lane), district);
      }

      vec3 col = grass;
      // soft shadow in the grass just outside paths and plazas, so they look slightly sunk in
      float rim = max(smoothstep(0.30, 0.47, plazaE) * (1.0 - plaza), smoothstep(0.28, 0.45, pathE) * (1.0 - path));
      col *= 1.0 - rim * 0.16;
      col = mix(col, dirt, path);
      col = mix(col, plazaCol, plaza);

      gl_FragColor = vec4(col * uTint, 1.0);
    }
  `;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  }

  HS.Ground = function (canvas) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL is not available');
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

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uWorld = gl.getUniformLocation(prog, 'uWorld');
    const uGrid = gl.getUniformLocation(prog, 'uGrid');
    const uTint = gl.getUniformLocation(prog, 'uTint');
    let pixels = null;

    // Redraw the ground from the world's current plaza / path / village amounts.
    this.draw = function (world) {
      const n = world.W * world.H;
      if (!pixels || pixels.length !== n * 4) pixels = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        pixels[i * 4] = world.plaza[i] * 255;
        pixels[i * 4 + 1] = world.path[i] * 255;
        pixels[i * 4 + 2] = world.village[i] * 255;
        pixels[i * 4 + 3] = world.dist[i] * 255;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, world.W, world.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uWorld, world.W * HS.CS, world.H * HS.CS);
      gl.uniform4f(uGrid, world.grid.ox, world.grid.oy, world.grid.cw, world.grid.ch);
      gl.uniform3f(uTint, HS.tint[0], HS.tint[1], HS.tint[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  };
})(window.HS);
