// Hearthside: the Windows side of the app.
//
// The village itself is a web page (the `web` folder). This program's job is to:
//   1. open that page in a borderless window and slide the window behind the desktop icons,
//   2. keep reading where the desktop icons are and tell the page whenever they move,
//   3. sit in the system tray so the wallpaper can be closed.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop;

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

fn main() {
    tauri::Builder::default()
        .manage(Icons::default())
        .invoke_handler(tauri::generate_handler![get_icons])
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
                let mut last_fix = std::time::Instant::now();
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
                    std::thread::sleep(Duration::from_millis(400));
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Hearthside");
}
