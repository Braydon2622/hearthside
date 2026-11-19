# Cuts the generated sprite sheets (objects painted on a flat magenta background) into
# individual transparent PNGs, and splits the 2x2 ground-texture sheet into four tiles.
#
#   art/source/houses.png  ->  web/art/houses/00.png, 01.png, ...
#   art/source/trees.png   ->  web/art/trees/...
#   art/source/props.png   ->  web/art/props/...
#   art/source/v2/animals.png -> web/art/animals/...
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

  // One shared palette for every sprite: k-means over a sample of all opaque pixels, then every
  // pixel snaps to its nearest palette colour, then a consistent darkening along each outline.
  static double Dist(double r, double g, double b, double[] c) {
    double dr = r - c[0], dg = g - c[1], db = b - c[2], rm = (r + c[0]) * 0.5;
    return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
  }
  public static string Palette(string[] dirs, int k, int edge, double edgeDark) {
    var files = new List<string>();
    foreach (var d in dirs) files.AddRange(System.IO.Directory.GetFiles(d, "*.png"));
    files.Sort();
    var imgs = new List<byte[]>(); var dims = new List<int[]>(); var rnd = new Random(7); var samples = new List<double[]>();
    foreach (var f in files) {
      int w, h; var px = Load(f, out w, out h); imgs.Add(px); dims.Add(new int[] { w, h });
      double keep = Math.Min(1.0, 6000.0 / (w * h));    // about the same number of samples from every sprite
      for (int i = 0; i < w * h; i++) if (px[i * 4 + 3] > 200 && rnd.NextDouble() < keep) samples.Add(new double[] { px[i * 4 + 2], px[i * 4 + 1], px[i * 4] });
    }
    // k-means++ start
    var C = new List<double[]>(); C.Add(samples[rnd.Next(samples.Count)]);
    var dmin = new double[samples.Count];
    while (C.Count < k) {
      double sum = 0;
      for (int i = 0; i < samples.Count; i++) { double best = double.MaxValue; foreach (var c in C) best = Math.Min(best, Dist(samples[i][0], samples[i][1], samples[i][2], c)); dmin[i] = best; sum += best; }
      double pick = rnd.NextDouble() * sum; int j = 0; for (; j < samples.Count - 1; j++) { pick -= dmin[j]; if (pick <= 0) break; }
      C.Add((double[])samples[j].Clone());
    }
    var lab = new int[samples.Count];
    for (int it = 0; it < 16; it++) {
      var acc = new double[k, 4];
      for (int i = 0; i < samples.Count; i++) {
        int bi = 0; double bd = double.MaxValue;
        for (int c = 0; c < k; c++) { double d = Dist(samples[i][0], samples[i][1], samples[i][2], C[c]); if (d < bd) { bd = d; bi = c; } }
        lab[i] = bi; acc[bi, 0] += samples[i][0]; acc[bi, 1] += samples[i][1]; acc[bi, 2] += samples[i][2]; acc[bi, 3]++;
      }
      for (int c = 0; c < k; c++) if (acc[c, 3] > 0) C[c] = new double[] { acc[c, 0] / acc[c, 3], acc[c, 1] / acc[c, 3], acc[c, 2] / acc[c, 3] };
    }
    C.Sort((a, b) => (a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11).CompareTo(b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11));
    var cache = new Dictionary<int, int>();
    for (int n = 0; n < files.Count; n++) {
      var px = imgs[n]; int w = dims[n][0], h = dims[n][1];
      // distance (px) from each pixel to the outside, two-pass chamfer, capped at edge+1
      var dist = new float[w * h];
      for (int i = 0; i < w * h; i++) dist[i] = px[i * 4 + 3] < 128 ? 0 : 1e6f;
      for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) { int i = y * w + x; float v = dist[i]; if (v == 0) continue;
        v = Math.Min(v, x > 0 ? dist[i - 1] + 1 : 1); v = Math.Min(v, y > 0 ? dist[i - w] + 1 : 1);
        v = Math.Min(v, x > 0 && y > 0 ? dist[i - w - 1] + 1.414f : 1.414f); v = Math.Min(v, x < w - 1 && y > 0 ? dist[i - w + 1] + 1.414f : 1.414f); dist[i] = v; }
      for (int y = h - 1; y >= 0; y--) for (int x = w - 1; x >= 0; x--) { int i = y * w + x; float v = dist[i]; if (v == 0) continue;
        v = Math.Min(v, x < w - 1 ? dist[i + 1] + 1 : 1); v = Math.Min(v, y < h - 1 ? dist[i + w] + 1 : 1);
        v = Math.Min(v, x < w - 1 && y < h - 1 ? dist[i + w + 1] + 1.414f : 1.414f); v = Math.Min(v, x > 0 && y < h - 1 ? dist[i + w - 1] + 1.414f : 1.414f); dist[i] = v; }
      for (int i = 0; i < w * h; i++) {
        if (px[i * 4 + 3] == 0) continue;
        int r = px[i * 4 + 2], g = px[i * 4 + 1], b = px[i * 4], key = (r << 16) | (g << 8) | b, ci;
        if (!cache.TryGetValue(key, out ci)) { double bd = double.MaxValue; ci = 0; for (int c = 0; c < k; c++) { double d = Dist(r, g, b, C[c]); if (d < bd) { bd = d; ci = c; } } cache[key] = ci; }
        double f = 1.0;
        if (dist[i] < edge) f = 1.0 - edgeDark * (1.0 - dist[i] / edge);
        // darken toward a deep warm brown rather than black, the way a painted edge looks
        px[i * 4 + 2] = (byte)Math.Round(C[ci][0] * f + 46 * (1 - f)); px[i * 4 + 1] = (byte)Math.Round(C[ci][1] * f + 30 * (1 - f)); px[i * 4] = (byte)Math.Round(C[ci][2] * f + 36 * (1 - f));
      }
      Save(px, w, h, files[n]);
    }
    var sb = new System.Text.StringBuilder("[");
    for (int c = 0; c < k; c++) sb.Append((c > 0 ? ", " : "") + "\"#" + ((int)Math.Round(C[c][0])).ToString("x2") + ((int)Math.Round(C[c][1])).ToString("x2") + ((int)Math.Round(C[c][2])).ToString("x2") + "\"");
    return sb.Append("]").ToString();
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
# Sheets at the high eagle-eye camera (art/source/v2) win over the first-generation sheets.
foreach ($sheet in 'houses', 'trees', 'props', 'villagers', 'animals') {
  $src = Join-Path $root "art\source\v2\$sheet.png"
  if (-not (Test-Path $src)) { $src = Join-Path $root "art\source\$sheet.png" }
  if (-not (Test-Path $src)) { "missing $src"; continue }
  $out = Join-Path $root "web\art\$sheet"
  if (Test-Path $out) { Remove-Item $out -Recurse -Force }
  New-Item -ItemType Directory -Force $out | Out-Null
  "${sheet}: " + (([Cutter]::CutSheet($src, $out, 1500)) -join ', ')
}
# one shared 28-colour palette across every sprite, then the painted edge (5 px, up to 30 % darker)
$dirs = @('houses', 'trees', 'props', 'villagers', 'animals') | ForEach-Object { Join-Path $root "web\art\$_" } | Where-Object { Test-Path $_ }
$pal = [Cutter]::Palette([string[]]$dirs, 28, 5, 0.30)
Set-Content -Path (Join-Path $root 'web\art\palette.json') -Value $pal -Encoding ascii
"palette: $pal"
$ground = Join-Path $root 'art\source\ground.png'
if (Test-Path $ground) {
  $out = Join-Path $root 'web\art\ground'; New-Item -ItemType Directory -Force $out | Out-Null
  [Cutter]::SplitGround($ground, $out, @('grass', 'cobble', 'dirt', 'lawn'), 512)
  'ground: grass, cobble, dirt, lawn (512x512)'
}
