// Text characters for the ASCII side of the art: stars, dust, sparks, the little status line.
// Every character is drawn once, white, into one small texture (a grid of 32x32 cells); the renderer
// tints each copy with its own colour, size and twinkle.
(function (HS) {
  const CHARS = " .·:+*x×o°~-_|/\\()[]<>^v'`\",;=#%@&!?0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const CELL = 32, COLS = 16;
  const index = new Map();
  for (let i = 0; i < CHARS.length; i++) index.set(CHARS[i], i);
  HS.GLYPH_COLS = COLS;
  HS.GLYPH_ROWS = Math.ceil(CHARS.length / COLS);
  HS.glyph = (ch) => (index.has(ch) ? index.get(ch) : 0);

  HS.buildGlyphAtlas = function () {
    const c = document.createElement('canvas');
    c.width = COLS * CELL; c.height = HS.GLYPH_ROWS * CELL;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 24px Consolas, "Cascadia Mono", "Courier New", monospace';
    for (let i = 0; i < CHARS.length; i++) g.fillText(CHARS[i], (i % COLS) * CELL + CELL / 2, Math.floor(i / COLS) * CELL + CELL / 2 + 1);
    return c;
  };
})(window.HS);
