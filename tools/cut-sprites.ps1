# Cuts the generated sprite sheets (objects painted on a flat magenta background) into
# individual transparent PNGs, and splits the 2x2 ground-texture sheet into four tiles.
#
#   art/source/houses.png  ->  web/art/houses/00.png, 01.png, ...
#   art/source/trees.png   ->  web/art/trees/...
#   art/source/props.png   ->  web/art/props/...
#   art/source/ground.png  ->  web/art/ground/grass.png, cobble.png, dirt.png, lawn.png
#
# Sprites are numbered left to right, top to bottom, the same order they appear on the sheet.
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Add-Type -ReferencedAssemblies System.Drawing @'
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class Cutter {
  static byte[] Load(string path, out int w, out int h) {
    using (var src = new Bitmap(path)) using (var bmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(bmp)) g.DrawImage(src, 0, 0, src.Width, src.Height);
      w = bmp.Width; h = bmp.Height;
      var d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      var buf = new byte[w * h * 4]; Marshal.Copy(d.Scan0, buf, 0, buf.Length); bmp.UnlockBits(d); return buf;
    }
  }
  static void Save(byte[] buf, int w, int h, string path) {
    using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
      var d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      Marshal.Copy(buf, 0, d.Scan0, buf.Length); bmp.UnlockBits(d); bmp.Save(path, ImageFormat.Png);
    }
  }
  // How magenta a pixel is: high red and blue, low green. Background is about 255, painted things under 60.
  static int Key(byte[] p, int i) { return Math.Min(p[i + 2], p[i]) - p[i + 1]; }

  public static List<string> CutSheet(string path, string outDir, int minArea) {
    int w, h; var px = Load(path, out w, out h);
    var solid = new bool[w * h];
    for (int i = 0; i < w * h; i++) solid[i] = Key(px, i * 4) < 110;
    // group pixels into objects; pixels up to 3 apart count as touching so thin detached bits stay with their object
    var label = new int[w * h]; var boxes = new List<int[]>(); var stack = new Stack<int>();
    for (int s = 0; s < w * h; s++) {
      if (!solid[s] || label[s] != 0) continue;
      int id = boxes.Count + 1; int x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
      label[s] = id; stack.Push(s);
      while (stack.Count > 0) {
        int c = stack.Pop(), cx = c % w, cy = c / w; area++;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
        for (int dy = -3; dy <= 3; dy++) for (int dx = -3; dx <= 3; dx++) {
          int nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          int n = ny * w + nx; if (solid[n] && label[n] == 0) { label[n] = id; stack.Push(n); }
        }
      }
      boxes.Add(new int[] { x0, y0, x1, y1, area, id });
    }
    var big = boxes.FindAll(b => b[4] >= minArea);
    // reading order: group into rows by vertical centre, then left to right
    big.Sort((a, b) => (a[1] + a[3]).CompareTo(b[1] + b[3]));
    var ordered = new List<int[]>(); var row = new List<int[]>();
    foreach (var b in big) {
      if (row.Count > 0 && (b[1] + b[3]) / 2 > row[0][3]) { row.Sort((p, q) => p[0].CompareTo(q[0])); ordered.AddRange(row); row.Clear(); }
      row.Add(b);
    }
    row.Sort((p, q) => p[0].CompareTo(q[0])); ordered.AddRange(row);

    var report = new List<string>(); int n2 = 0;
    foreach (var b in ordered) {
      int bw = b[2] - b[0] + 1, bh = b[3] - b[1] + 1; var o = new byte[bw * bh * 4];
      for (int y = 0; y < bh; y++) for (int x = 0; x < bw; x++) {
        int si = ((b[1] + y) * w + b[0] + x), s4 = si * 4, d4 = (y * bw + x) * 4;
        if (label[si] != b[5]) continue;
        int k = Key(px, s4);
        double a = k <= 50 ? 1.0 : k >= 130 ? 0.0 : 1.0 - (k - 50) / 80.0;     // soft edge
        int g = px[s4 + 1], r = px[s4 + 2], bl = px[s4];
        if (a < 1.0) { r = (int)(g + (r - g) * a); bl = (int)(g + (bl - g) * a); }   // take the pink fringe out of edge pixels
        o[d4] = (byte)bl; o[d4 + 1] = (byte)g; o[d4 + 2] = (byte)r; o[d4 + 3] = (byte)(a * 255);
      }
      string name = n2.ToString("00") + ".png"; Save(o, bw, bh, System.IO.Path.Combine(outDir, name));
      report.Add(name + " " + bw + "x" + bh); n2++;
    }
    return report;
  }

  public static void SplitGround(string path, string outDir, string[] names, int size) {
    using (var src = new Bitmap(path)) {
      int hw = src.Width / 2, hh = src.Height / 2, inset = 10;
      for (int i = 0; i < 4; i++) using (var tile = new Bitmap(size, size, PixelFormat.Format32bppArgb)) {
        using (var g = Graphics.FromImage(tile)) {
          g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
          g.DrawImage(src, new Rectangle(0, 0, size, size), new Rectangle((i % 2) * hw + inset, (i / 2) * hh + inset, hw - inset * 2, hh - inset * 2), GraphicsUnit.Pixel);
        }
        tile.Save(System.IO.Path.Combine(outDir, names[i] + ".png"), ImageFormat.Png);
      }
    }
  }
}
'@
foreach ($sheet in 'houses', 'trees', 'props', 'villagers') {
  $src = Join-Path $root "art\source\$sheet.png"
  if (-not (Test-Path $src)) { "missing $src"; continue }
  $out = Join-Path $root "web\art\$sheet"
  if (Test-Path $out) { Remove-Item $out -Recurse -Force }
  New-Item -ItemType Directory -Force $out | Out-Null
  "${sheet}: " + (([Cutter]::CutSheet($src, $out, 1500)) -join ', ')
}
$ground = Join-Path $root 'art\source\ground.png'
if (Test-Path $ground) {
  $out = Join-Path $root 'web\art\ground'; New-Item -ItemType Directory -Force $out | Out-Null
  [Cutter]::SplitGround($ground, $out, @('grass', 'cobble', 'dirt', 'lawn'), 512)
  'ground: grass, cobble, dirt, lawn (512x512)'
}
