// Everything that talks to the Windows desktop itself.
//
// Two jobs:
//   attach_behind_icons  - put our window between the wallpaper and the desktop icons
//   read_icons           - ask Explorer where every desktop icon currently is
//
// Neither is an officially documented feature. Both are long-standing techniques that live
// wallpaper apps rely on, and a Windows update can change the details (it did in Windows 11 24H2,
// which is why there are two code paths below).

use serde::Serialize;
use windows::core::{w, Interface, BOOL};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, IServiceProvider, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    IEnumIDList, IFolderView, IShellBrowser, IShellWindows, SID_STopLevelBrowser, ShellWindows, CSIDL_DESKTOP,
    SVGIO_ALLVIEW, SWC_DESKTOP, SWFO_NEEDDISPATCH,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetClientRect, GetWindowLongPtrW, SendMessageTimeoutW,
    SetLayeredWindowAttributes, SetParent, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE, LWA_ALPHA,
    SMTO_NORMAL, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, WS_CAPTION, WS_CHILD, WS_EX_LAYERED,
    WS_EX_NOREDIRECTIONBITMAP, WS_POPUP, WS_THICKFRAME,
};

/// One desktop icon, as a rectangle in the web page's own pixel units.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct IconRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

fn hwnd(raw: isize) -> HWND {
    HWND(raw as *mut core::ffi::c_void)
}

/// Finds the old-style wallpaper window: a top-level "WorkerW" that comes right after the
/// top-level window holding the icons. Only exists on Windows 10 and Windows 11 before 24H2.
unsafe extern "system" fn find_classic_workerw(top: HWND, out: LPARAM) -> BOOL {
    if FindWindowExW(Some(top), None, w!("SHELLDLL_DefView"), None).is_ok() {
        if let Ok(worker) = FindWindowExW(None, Some(top), w!("WorkerW"), None) {
            *(out.0 as *mut isize) = worker.0 as isize;
        }
    }
    BOOL(1)
}

/// Puts the given window behind the desktop icons. Returns a short note on which method worked.
pub fn attach_behind_icons(raw: isize) -> Result<String, String> {
    unsafe {
        let ours = hwnd(raw);
        let progman = FindWindowW(w!("Progman"), None).map_err(|e| format!("no Progman window: {e}"))?;

        // Ask the desktop to create its separate wallpaper layer. This is the same message Windows
        // sends itself when it needs to animate a wallpaper change.
        let mut _result = 0usize;
        SendMessageTimeoutW(progman, 0x052C, WPARAM(0xD), LPARAM(0x1), SMTO_NORMAL, 1000, Some(&mut _result));

        let ex_progman = GetWindowLongPtrW(progman, GWL_EXSTYLE) as u32;
        let defview_in_progman = FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), None).ok();
        let worker_in_progman = FindWindowExW(Some(progman), None, w!("WorkerW"), None).ok();

        // We become a plain child window with no frame.
        let style = GetWindowLongPtrW(ours, GWL_STYLE) as u32;
        let style = (style & !(WS_POPUP.0 | WS_CAPTION.0 | WS_THICKFRAME.0)) | WS_CHILD.0;
        SetWindowLongPtrW(ours, GWL_STYLE, style as isize);

        let (parent, note) = if let (Some(defview), true) =
            (defview_in_progman, ex_progman & WS_EX_NOREDIRECTIONBITMAP.0 != 0 || worker_in_progman.is_some())
        {
            // Windows 11 24H2 and later: icons and wallpaper are both children of Progman.
            // We go in as a third child, stacked just under the icons and above the wallpaper.
            let ex = GetWindowLongPtrW(ours, GWL_EXSTYLE) as u32;
            SetWindowLongPtrW(ours, GWL_EXSTYLE, (ex | WS_EX_LAYERED.0) as isize);
            let _ = SetLayeredWindowAttributes(ours, windows::Win32::Foundation::COLORREF(0), 255, LWA_ALPHA);
            SetParent(ours, Some(progman)).map_err(|e| format!("SetParent(Progman) failed: {e}"))?;
            let _ = SetWindowPos(ours, Some(defview), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            if let Some(worker) = worker_in_progman {
                let _ = SetWindowPos(worker, Some(ours), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
            (progman, "Windows 11 24H2+ layout (child of Progman)")
        } else {
            // Older layout: a separate top-level WorkerW sits behind the icons; we move into it.
            let mut worker_raw: isize = 0;
            let _ = EnumWindows(Some(find_classic_workerw), LPARAM(&mut worker_raw as *mut isize as isize));
            if worker_raw == 0 {
                return Err("could not find the wallpaper layer (WorkerW)".into());
            }
            let worker = hwnd(worker_raw);
            SetParent(ours, Some(worker)).map_err(|e| format!("SetParent(WorkerW) failed: {e}"))?;
            (worker, "classic layout (child of WorkerW)")
        };

        // Fill the whole desktop.
        let mut rc = RECT::default();
        GetClientRect(parent, &mut rc).map_err(|e| format!("GetClientRect failed: {e}"))?;
        let flags = SWP_NOACTIVATE | SWP_SHOWWINDOW;
        let after = if parent == progman { defview_in_progman } else { None };
        let _ = SetWindowPos(ours, after, 0, 0, rc.right - rc.left, rc.bottom - rc.top, flags);
        Ok(format!("{note}, {}x{}", rc.right - rc.left, rc.bottom - rc.top))
    }
}

thread_local! {
    // COM (the system Explorer speaks) has to be switched on once per thread that uses it.
    static COM_READY: bool = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok() };
}

/// Asks Explorer for the position of every desktop icon.
/// Only positions are read: no file names, no file contents.
pub fn read_icons(our_window: isize) -> Result<Vec<IconRect>, String> {
    COM_READY.with(|_| ());
    unsafe { read_icons_inner(our_window).map_err(|e| e.to_string()) }
}

unsafe fn read_icons_inner(our_window: isize) -> windows::core::Result<Vec<IconRect>> {
    // Explorer keeps a list of its open windows; the desktop is one of them.
    let shell_windows: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_ALL)?;
    let mut desktop_hwnd = 0i32;
    let desktop = shell_windows.FindWindowSW(
        &VARIANT::from(CSIDL_DESKTOP as i32),
        &VARIANT::default(),
        SWC_DESKTOP,
        &mut desktop_hwnd,
        SWFO_NEEDDISPATCH,
    )?;
    let provider: IServiceProvider = desktop.cast()?;
    let browser: IShellBrowser = provider.QueryService(&SID_STopLevelBrowser)?;
    let view: IFolderView = browser.QueryActiveShellView()?.cast()?;

    // Size of one icon cell (icon plus label), and the icons themselves.
    let mut spacing = POINT::default();
    view.GetSpacing(Some(&mut spacing))?;
    let items: IEnumIDList = view.Items(SVGIO_ALLVIEW.0 as u32)?;

    // Explorer reports real screen pixels; the web page works in scaled pixels (e.g. 150% display).
    let scale = GetDpiForWindow(hwnd(our_window)).max(96) as f64 / 96.0;
    let px = |v: i32| (v as f64 / scale).round() as i32;

    let mut out = Vec::new();
    loop {
        let mut item: [*mut ITEMIDLIST; 1] = [std::ptr::null_mut()];
        let mut fetched = 0u32;
        if items.Next(&mut item, Some(&mut fetched)).is_err() || fetched == 0 || item[0].is_null() {
            break;
        }
        if let Ok(pt) = view.GetItemPosition(item[0]) {
            out.push(IconRect { x: px(pt.x), y: px(pt.y), w: px(spacing.x), h: px(spacing.y) });
        }
        CoTaskMemFree(Some(item[0] as *const core::ffi::c_void));
    }
    out.sort_by_key(|r| (r.x, r.y));
    Ok(out)
}
