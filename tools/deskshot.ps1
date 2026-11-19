param([string]$Out, [int]$WaitSec = 0)
Add-Type -ReferencedAssemblies System.Drawing @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic; using System.Drawing;
public static class D {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc p, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  public struct RECT { public int L, T, R, B; }
  public static string Cls(IntPtr h){ var s=new StringBuilder(256); GetClassName(h,s,256); return s.ToString(); }
  public static string Info(IntPtr h){ RECT r; GetWindowRect(h, out r); return String.Format("{0} 0x{1:X} vis={2} style=0x{3:X} ex=0x{4:X} rect={5},{6},{7},{8}", Cls(h), h.ToInt64(), IsWindowVisible(h), GetWindowLongPtr(h,-16).ToInt64(), GetWindowLongPtr(h,-20).ToInt64(), r.L,r.T,r.R,r.B); }
  public static List<string> Dump(){ var o=new List<string>(); IntPtr pm=FindWindow("Progman",null); o.Add("PROGMAN: "+Info(pm)+" dpi="+GetDpiForWindow(pm));
    // direct children in z-order, top first
    IntPtr c = GetWindow(pm, 5);
    while(c != IntPtr.Zero){ o.Add("  z-child: "+Info(c)); c = GetWindow(c, 2); }
    return o; }
  public static void Shot(string path){ IntPtr pm=FindWindow("Progman",null); RECT r; GetWindowRect(pm, out r);
    using(var b=new Bitmap(r.R-r.L, r.B-r.T)){ using(var g=Graphics.FromImage(b)){ IntPtr dc=g.GetHdc(); PrintWindow(pm, dc, 2); g.ReleaseHdc(dc); } b.Save(path, System.Drawing.Imaging.ImageFormat.Png); } }
}
'@
[D]::SetProcessDPIAware() | Out-Null
$deadline = (Get-Date).AddSeconds($WaitSec)
while ((Get-Date) -lt $deadline -and -not (Get-Process hearthside -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 500 }
if ($WaitSec -gt 0) { Start-Sleep -Seconds 4 }
"hearthside running: $([bool](Get-Process hearthside -ErrorAction SilentlyContinue))"
[D]::Dump()
[D]::Shot($Out)
$Out
