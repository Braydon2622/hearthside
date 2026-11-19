// The ground of the code-art world: a near-black void, drawn by the graphics card from the land
// field (see field.js) into an off-screen picture that is only repainted while the field morphs or
// the colours of the hour move on.
//
// What it draws:
//   - faint topographic lines over the whole screen, from a slow noise "terrain";
//   - a dim dot grid, like graph paper;
//   - the open ground around the icons as glowing contour rings: a bright edge, then fainter rings
//     stepping outward, so each group of icons sits in its own little map;
//   - district blocks as a faint circuit: lanes as thin lines with nodes where they cross.
// The inside of each clearing stays dark, so white icon labels read clearly.
(function (HS) {
  const VERT = `#version 300 es
    layout(location = 0) in vec2 p;
    void main() { gl_Position = vec4(p, 0.0, 1.0); }
  `;

  const FRAG = `#version 300 es
    precision highp float;
    uniform vec2 uRes, uFieldPx;
    uniform sampler2D uOld, uNew;
    uniform vec3 uDrop;
    uniform float uT, uMorph;
    uniform vec4 uGrid;
    uniform vec3 uBg, uContour, uFlora;
    out vec4 outColor;

    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { return noise(p) * 0.55 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 + 9.1) * 0.15; }

    vec4 field(vec2 px) {
      vec2 uv = px / uFieldPx;
      vec4 a = texture(uOld, uv), b = texture(uNew, uv);
      float delay = uDrop.z > 0.5 ? min(0.9, length(px - uDrop.xy) / 900.0) : 0.0;
      float t = smoothstep(0.0, 1.0, clamp((uT - delay) / uMorph, 0.0, 1.0));
      return mix(a, b, t);
    }
    // an anti-aliased line where v crosses a multiple of step (width in pixels)
    float iso(float v, float stepv, float width) {
      float d = abs(fract(v / stepv + 0.5) - 0.5) * stepv;
      float w = fwidth(v) * width;
      return 1.0 - smoothstep(w * 0.5, w * 1.5, d);
    }

    void main() {
      vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
      vec4 f = field(px);
      vec3 col = uBg * (0.92 + fbm(px / 600.0) * 0.16);

      // terrain lines across the whole void, very faint
      float h = fbm(px / 420.0 + 2.0) * 1.2 + fbm(px / 140.0 + 9.0) * 0.12;
      float topo = iso(h, 0.055, 1.0);
      float quietIcon = smoothstep(10.0, 60.0, f.g);               // keep the space right round icons calm
      col += uFlora * topo * 0.22 * quietIcon;

      // graph-paper dots every 24 px
      vec2 gp = fract(px / 24.0) - 0.5;
      float dotg = 1.0 - smoothstep(0.03, 0.07, length(gp));
      col += uFlora * dotg * 0.25 * quietIcon;

      // contour rings around the clearings
      float sdf = f.r + (noise(px / 7.0) - 0.5) * 0.8;
      float edge = 1.0 - smoothstep(0.6, 1.8, abs(sdf));
      float outside = smoothstep(-1.0, 1.0, sdf);
      float rings = iso(sdf, 9.0, 1.0) * outside * (1.0 - smoothstep(4.0, 46.0, sdf));
      // a dashed outermost ring
      float dash = step(0.5, fract((px.x + px.y) / 9.0));
      float outer = iso(sdf - 4.5, 54.0, 1.0) * smoothstep(40.0, 50.0, sdf) * (1.0 - smoothstep(58.0, 66.0, sdf)) * dash;
      col += uContour * (edge * 0.9 + rings * 0.32 + outer * 0.22);
      // the inside of a clearing is a touch darker than the void, so labels stand out
      col *= 1.0 - smoothstep(1.0, -6.0, sdf) * 0.35;

      // districts: a faint circuit of lanes along the icon grid, with nodes at the crossings
      float district = smoothstep(1.5, -1.5, f.b);
      if (district > 0.0) {
        vec2 g = px - uGrid.xy;
        vec2 cell = floor(g / uGrid.zw), loc = g - cell * uGrid.zw;
        float dx = min(loc.x, uGrid.z - loc.x), dy = min(loc.y, uGrid.w - loc.y);
        float lane = max(1.0 - smoothstep(0.4, 1.3, dx), 1.0 - smoothstep(0.4, 1.3, dy));
        float node = 1.0 - smoothstep(2.0, 3.2, length(vec2(dx, dy)));
        col += uContour * district * (lane * 0.28 + node * 0.7);
      }

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

  // gl: the shared WebGL2 context. Texture units 5-6 hold the field.
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
    const U = {};
    for (const n of ['uRes', 'uFieldPx', 'uDrop', 'uT', 'uMorph', 'uGrid', 'uBg', 'uContour', 'uFlora']) U[n] = gl.getUniformLocation(prog, n);
    let uploaded = -1, uploadedField = null;

    this.draw = function (world, w, h) {
      const f = world.field;
      if (f.version !== uploaded || f !== uploadedField) {
        uploaded = f.version; uploadedField = f;
        for (const [unit, tex, data] of [[5, texOld, f.old], [6, texNew, f.next]]) {
          gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, f.w, f.h, 0, gl.RGBA, gl.FLOAT, data);
        }
      }
      const P = HS.pal;
      gl.useProgram(prog);
      gl.bindVertexArray(quadVao);
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.uRes, w, h);
      gl.uniform2f(U.uFieldPx, f.w * f.res, f.h * f.res);
      gl.uniform3f(U.uDrop, f.drop ? f.drop.x : 0, f.drop ? f.drop.y : 0, f.drop ? 1 : 0);
      gl.uniform1f(U.uT, Math.min(f.t, 1e4));
      gl.uniform1f(U.uMorph, HS.MORPH);
      gl.uniform4f(U.uGrid, world.grid.ox, world.grid.oy, world.grid.cw, world.grid.ch);
      gl.uniform3fv(U.uBg, P.bg); gl.uniform3fv(U.uContour, P.contour); gl.uniform3fv(U.uFlora, P.flora);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  };
})(window.HS);
