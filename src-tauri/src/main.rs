// Hearthside: the Windows side of the app.
//
// The village itself is a web page (the `web` folder). This program's job is to:
//   1. open that page in a borderless window and slide the window behind the desktop icons,
//   2. keep reading where the desktop icons are and tell the page whenever they move,
//   3. sit in the system tray so the wallpaper can be closed.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};

/// The most recent icon rectangles, kept so the page can ask for them when it first loads.
#[derive(Default)]
struct Icons(Mutex<Vec<desktop::IconRect>>);

#[tauri::command]
fn get_icons(state: tauri::State<Icons>) -> Vec<desktop::IconRect> {
    state.0.lock().unwrap().clone()
}

/// Whether a window is currently hiding the desktop, kept so the page can ask when it loads
/// (it may finish loading after the first "covered" message was sent).
#[derive(Default)]
struct Covered(AtomicBool);

#[tauri::command]
fn get_covered(state: tauri::State<Covered>) -> bool {
    state.0.load(Ordering::Relaxed)
}

fn main() {
    tauri::Builder::default()
        .manage(Icons::default())
        .manage(Covered::default())
        .invoke_handler(tauri::generate_handler![get_icons, get_covered])
        .setup(|app| {
            let window = app.get_webview_window("wallpaper").expect("wallpaper window is defined in tauri.conf.json");

            // Tray icon with a single "Quit" entry. Without it there would be no way to close a
            // window that has no title bar and lives behind the icons.
            let quit = MenuItem::with_id(app, "quit", "Quit Hearthside", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("app icon").clone())
                .tooltip("Hearthside")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            // Slide the window behind the desktop icons.
            // (Show first: showing a window makes the windowing library re-apply its own styles,
            // which would undo ours if we attached before.)
            let hwnd = window.hwnd()?.0 as isize;
            window.show()?;
            match desktop::attach_behind_icons(hwnd) {
                Ok(how) => println!("attached behind icons: {how}"),
                Err(e) => eprintln!("could not attach behind icons: {e}"),
            }

            // Watch the icons. A background thread re-reads their positions a few times a second
            // and only bothers the page when something actually changed.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last: Vec<desktop::IconRect> = Vec::new();
                let mut first = true;
                let mut covered = false;
                let no_pause = std::env::var_os("HEARTHSIDE_NO_PAUSE").is_some();
                let mut last_fix = std::time::Instant::now();
                let mut last_read = std::time::Instant::now();
                let mut watch_closely_until = std::time::Instant::now();
                loop {
                    // If anything pushed us out of place (Explorer restarting, a style reset),
                    // quietly slide back behind the icons.
                    if !desktop::is_behind_icons(hwnd) && last_fix.elapsed() > Duration::from_secs(5) {
                        last_fix = std::time::Instant::now();
                        match desktop::attach_behind_icons(hwnd) {
                            Ok(how) => println!("re-attached behind icons: {how}"),
                            Err(e) => eprintln!("could not re-attach: {e}"),
                        }
                    }
                    // Nobody can see the wallpaper behind a maximised window: tell the page to
                    // stop animating, and skip reading the icons until the desktop is back.
                    // (Setting HEARTHSIDE_NO_PAUSE keeps it running regardless, for measuring.)
                    let now_covered = !no_pause && desktop::is_desktop_covered(hwnd);
                    if now_covered != covered {
                        covered = now_covered;
                        println!("desktop covered: {covered}");
                        handle.state::<Covered>().0.store(covered, Ordering::Relaxed);
                        let _ = handle.emit("wallpaper-covered", covered);
                    }
                    // Asking Explorer for every icon's position is the costly part, so do it often
                    // only while the mouse is in use (icons move by being dragged). Otherwise a
                    // slow check every two seconds catches things like a newly saved file.
                    if desktop::mouse_active() {
                        watch_closely_until = std::time::Instant::now() + Duration::from_secs(3);
                    }
                    let closely = std::time::Instant::now() < watch_closely_until;
                    if covered || (!first && !closely && last_read.elapsed() < Duration::from_secs(2)) {
                        std::thread::sleep(Duration::from_millis(250));
                        continue;
                    }
                    last_read = std::time::Instant::now();
                    match desktop::read_icons(hwnd) {
                        Ok(now) => {
                            if first || now != last {
                                println!("icons: {} (first: {:?})", now.len(), now.first());
                                first = false;
                                last = now.clone();
                                *handle.state::<Icons>().0.lock().unwrap() = now.clone();
                                let _ = handle.emit("desktop-icons", now);
                            }
                        }
                        Err(e) => eprintln!("could not read icons: {e}"),
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Hearthside");
}
