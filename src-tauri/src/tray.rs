use crate::settings::{CloseBehavior, SettingsState};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Err(error) = window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
    {
        eprintln!("Could not restore main window: {error}");
    }
}

pub fn initialize(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示 NewBee", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", "上一首", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "播放/暂停", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &previous, &toggle, &next, &separator, &exit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("NewBee")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "exit" => app.exit(0),
            command @ ("previous" | "toggle" | "next") => {
                if let Err(error) = app.emit_to("main", "system-media-command", command) {
                    eprintln!("Could not forward tray playback command: {error}");
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    api.prevent_close();
    match window.state::<SettingsState>().close_behavior() {
        CloseBehavior::Tray => {
            // Keep the webview alive so queue controls and track transitions keep running.
            if let Err(error) = window.hide() {
                eprintln!("Could not hide main window: {error}");
            }
        }
        CloseBehavior::Exit => window.app_handle().exit(0),
    }
}
