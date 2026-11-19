// The ground (grass, cobblestone plazas, dirt tracks, district lawns) is painted by the graphics
// card from the land field (see field.js), into an off-screen picture that is only redrawn while
// the field morphs. The field arrives as two small float textures, the previous one and the new
// one, and the shader morphs between them itself, rippling out from where an icon was dropped.
//
// The look is gouache: painted texture tiles, broken up by brush-stroke noise whose direction
// wanders across the screen, and clearings that read as shallow sunken plazas seen from above:
// a crisp edge, a darker grass lip around it, a soft shadow inside under the lip on the side the
// light comes from (top-left), and a faintly lit inner wall on the opposite side.
(function (HS) {
  const VERT = `#version 300 es
    layout(location = 0) in vec2 p;
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
    uniform sampler2D uGrass, uCobble, uDirt, uLawn;   // painted ground textures
    uniform float uUseTex;   // 1 once those textures have loaded
    out vec4 outColor;

    const vec2 LIGHT = vec2(0.7071, 0.7071);   // direction the light travels (from top-left)

    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { return noise(p) * 0.55 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 + 9.1) * 0.15; }

    // Brush strokes: stretched noise whose direction drifts slowly across the screen.
    float strokes(vec2 px, float len, float wid, float seed) {
      float a = (fbm(px / 520.0 + seed) - 0.5) * 5.0 + seed;
      vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * px;
      return noise(vec2(q.x / len, q.y / wid) + seed * 13.0);
    }

    // Cobblestones: x = distance to the nearest stone edge, y = a random value per stone,
    // zw = direction from this point to the middle of its stone.
    vec4 stones(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      float d1 = 9.0, d2 = 9.0, id = 0.0;
      vec2 toC = vec2(0.0);
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(hash(i + g), hash(i + g + 17.3)) * 0.8 + 0.1;
        vec2 r = g + o - f;
        float d = length(r);
        if (d < d1) { d2 = d1; d1 = d; id = hash(i + g + 5.1); toC = r; } else if (d < d2) { d2 = d; }
      }
      return vec4(d2 - d1, id, toC);
    }

    // The land field here, part way between the old and the new one.
    vec4 field(vec2 px) {
      vec2 uv = px / uFieldPx;
      vec4 a = texture(uOld, uv), b = texture(uNew, uv);
      float delay = uDrop.z > 0.5 ? min(0.9, length(px - uDrop.xy) / 900.0) : 0.0;
      float t = smoothstep(0.0, 1.0, clamp((uT - delay) / uMorph, 0.0, 1.0));
      return mix(a, b, t);
    }
    // Clearing distance with its brushy wobble (the same everywhere it is asked for).
    float edge(vec2 px, float raw) {
      return raw + (fbm(px / 13.0) - 0.5) * 4.5 + (fbm(px / 47.0 + 6.0) - 0.5) * 7.0;
    }

    void main() {
      vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
      vec4 f = field(px);
      float village = f.a;
      float big = fbm(px / 260.0);
      float fine = noise(px / 5.0);
      float sBig = strokes(px, 34.0, 9.0, 1.0), sFine = strokes(px, 14.0, 3.5, 2.7);

      // --- grass: painted tile, two hues drifting across the meadow, brush strokes on top ---
      vec3 grass = mix(vec3(0.33, 0.52, 0.25), vec3(0.50, 0.66, 0.30), big);
      if (uUseTex > 0.5) grass = texture(uGrass, px / 200.0).rgb * mix(vec3(0.86, 0.92, 0.84), vec3(1.06, 1.04, 0.90), big);
      grass = mix(grass, grass * vec3(1.06, 1.03, 0.86), village * 0.35);         // sunnier in the village
      grass *= 0.88 + sBig * 0.20;
      grass = mix(grass, grass * vec3(0.86, 1.02, 1.04), smoothstep(0.55, 0.85, sFine) * 0.5);   // cool strokes
      grass = mix(grass, grass * vec3(1.10, 1.06, 0.84), smoothstep(0.62, 0.9, strokes(px, 20.0, 5.0, 4.1)) * 0.45); // warm strokes

      // --- clearing outline ---
      float sdf = edge(px, f.r);
      float inside = smoothstep(0.9, -0.9, sdf);                  // crisp, painted edge
      // a darker, richer lip of grass right around the edge
      float lip = smoothstep(8.0, 0.5, sdf) * (1.0 - inside);
      grass = mix(grass, grass * vec3(0.52, 0.62, 0.50), lip * (0.65 + sFine * 0.35));
      grass *= 1.0 - smoothstep(22.0, 6.0, sdf) * (1.0 - inside) * 0.08;   // the lawn dips toward it

      // --- the floor of the clearing ---
      // near icons it is a plaza, further out (along paths) it is a dirt track
      float plazaness = 1.0 - smoothstep(30.0, 46.0, f.g + (fbm(px / 16.0) - 0.5) * 14.0);
      vec3 dirt = mix(vec3(0.74, 0.62, 0.43), vec3(0.82, 0.72, 0.52), fbm(px / 22.0 + 5.0));
      // painted cobbles: warm pale stones lit from the top-left, soft blue-grey gaps; quieter
      // right under the icons so their labels stay easy to read
      float quiet = mix(0.35, 1.0, smoothstep(0.0, 22.0, f.g));
      vec4 st = stones((px + vec2(fbm(px / 9.0), fbm(px / 9.0 + 3.0)) * 4.0) / 15.0);
      vec3 stone = mix(vec3(0.71, 0.64, 0.53), vec3(0.63, 0.59, 0.54), st.y);
      stone = mix(stone, vec3(0.66, 0.63, 0.60), step(0.78, st.y) * 0.6);
      stone *= 1.0 + clamp(dot(st.zw, LIGHT) * 2.2, -1.0, 1.0) * 0.08 * quiet;
      stone = mix(stone, vec3(0.45, 0.45, 0.48), (1.0 - smoothstep(0.03, 0.13, st.x)) * 0.7 * quiet);
      vec3 meadow = mix(vec3(0.62, 0.76, 0.40), vec3(0.72, 0.82, 0.46), fbm(px / 40.0 + 2.0));
      vec3 tLawn = texture(uLawn, px / 240.0).rgb;
      if (uUseTex > 0.5) {
        dirt = texture(uDirt, px / 300.0).rgb;
        // the painted cobble tile only lends its brushwork, so its mirrored repeats do not show
        float brush = dot(texture(uCobble, px / 150.0 + 0.37).rgb, vec3(0.33));
        stone *= 0.9 + brush * 0.22;
        meadow = tLawn * vec3(0.84, 0.94, 0.74);
      }
      meadow *= 0.86 + sBig * 0.2;
      meadow = mix(meadow, meadow * vec3(0.88, 1.02, 1.0), smoothstep(0.55, 0.85, sFine) * 0.5);
      dirt *= 0.92 + sBig * 0.14;
      stone *= 0.95 + sBig * 0.08;
      vec3 floorCol = mix(meadow, stone, smoothstep(0.40, 0.60, village + (fbm(px / 16.0) - 0.5) * 0.3));
      floorCol = mix(dirt, floorCol, plazaness);

      // district: a patchwork of lawn lots (one per icon slot) divided by cobbled lanes
      float district = smoothstep(1.5, -1.5, f.b + (fbm(px / 16.0) - 0.5) * 4.0);
      if (district > 0.0) {
        vec2 gp = px - uGrid.xy;
        vec2 cell = floor(gp / uGrid.zw), loc = gp - cell * uGrid.zw;
        float dx = min(loc.x, uGrid.z - loc.x), dy = min(loc.y, uGrid.w - loc.y);
        float lw = fbm(px / 9.0 + 4.0) * 5.0;
        float lane = max(1.0 - smoothstep(8.0, 10.0, dx + lw), 1.0 - smoothstep(5.0, 7.0, dy + lw));
        vec3 lawn = mix(vec3(0.47, 0.66, 0.33), vec3(0.58, 0.74, 0.39), fbm(px / 50.0 + 8.0));
        if (uUseTex > 0.5) lawn = tLawn;
        lawn *= 0.93 + hash(cell) * 0.12;                 // each lot a slightly different green
        lawn *= 0.90 + sBig * 0.16;
        // lots are slightly raised beds: dark lip toward the lane, shade on the lane under the top-left kerb
        float kerb = max(1.0 - smoothstep(10.0, 15.0, dx + lw), 1.0 - smoothstep(7.0, 12.0, dy + lw)) * (1.0 - lane);
        lawn = mix(lawn, lawn * vec3(0.66, 0.72, 0.60), kerb * 0.6);
        floorCol = mix(floorCol, mix(lawn, stone, lane), district);
      }

      // the plaza floor is a step below the grass: shadow under the lip on the light side,
      // a lit inner wall on the far side, and a faint darkening all around the edge
      float s1 = edge(px - LIGHT * 5.0, field(px - LIGHT * 5.0).r);
      float s2 = edge(px - LIGHT * 11.0, field(px - LIGHT * 11.0).r);
      float shade = smoothstep(-2.0, 3.0, s1) * 0.6 + smoothstep(-2.0, 3.0, s2) * 0.4;
      float sl = edge(px + LIGHT * 4.0, field(px + LIGHT * 4.0).r);
      float lit = smoothstep(-2.5, 1.5, sl) * smoothstep(-6.0, -1.0, sdf) * (1.0 - shade);
      floorCol *= 1.0 - smoothstep(-7.0, 0.0, sdf) * 0.12;
      floorCol = mix(floorCol, floorCol * vec3(0.58, 0.62, 0.78), shade * 0.7);
      floorCol = mix(floorCol, floorCol * vec3(1.10, 1.06, 0.94) + 0.03, lit * 0.7);

      vec3 col = mix(grass, floorCol, inside);
      col *= 0.97 + fine * 0.05;
      outColor = vec4(col, 1.0);
    }
  `;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  HS.glProgram = function (gl, vs, fs) {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    return prog;
  };

  // gl: the shared WebGL2 context. Texture units 1-4 hold the ground tiles, 5-6 the field.
  HS.Ground = function (gl, quadVao) {
    const prog = HS.glProgram(gl, VERT, FRAG);
    gl.useProgram(prog);

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
    ['uGrass', 'uCobble', 'uDirt', 'uLawn'].forEach((n, i) => gl.uniform1i(gl.getUniformLocation(prog, n), 1 + i));

    const U = {};
    for (const n of ['uRes', 'uFieldPx', 'uDrop', 'uT', 'uMorph', 'uGrid', 'uUseTex']) U[n] = gl.getUniformLocation(prog, n);
    let uploaded = -1, uploadedField = null, useTex = 0;

    // Load the four painted ground textures; calls done() when they are all in use.
    this.loadTextures = function (done) {
      const names = ['grass', 'cobble', 'dirt', 'lawn'];
      let left = names.length, failed = false;
      names.forEach((name, i) => {
        const img = new Image();
        img.onerror = () => { failed = true; if (--left === 0) done(false); };
        img.onload = () => {
          const t = gl.createTexture();
          gl.activeTexture(gl.TEXTURE1 + i); gl.bindTexture(gl.TEXTURE_2D, t);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
          if (--left === 0) { useTex = failed ? 0 : 1; done(!failed); }
        };
        img.src = 'art/ground/' + name + '.png';
      });
    };

    // Paint the ground into the currently bound framebuffer (w x h pixels).
    this.draw = function (world, w, h) {
      const f = world.field;
      if (f.version !== uploaded || f !== uploadedField) {
        uploaded = f.version; uploadedField = f;
        for (const [unit, tex, data] of [[5, texOld, f.old], [6, texNew, f.next]]) {
          gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, f.w, f.h, 0, gl.RGBA, gl.FLOAT, data);
        }
      }
      gl.useProgram(prog);
      gl.bindVertexArray(quadVao);
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.uRes, w, h);
      gl.uniform2f(U.uFieldPx, f.w * f.res, f.h * f.res);
      gl.uniform3f(U.uDrop, f.drop ? f.drop.x : 0, f.drop ? f.drop.y : 0, f.drop ? 1 : 0);
      gl.uniform1f(U.uT, Math.min(f.t, 1e4));
      gl.uniform1f(U.uMorph, HS.MORPH);
      gl.uniform4f(U.uGrid, world.grid.ox, world.grid.oy, world.grid.cw, world.grid.ch);
      gl.uniform1f(U.uUseTex, useTex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  };
})(window.HS);
