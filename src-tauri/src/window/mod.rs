pub(crate) mod tray;

use crate::settings::{CloseBehavior, SettingsState};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Sender},
    },
    time::Duration,
};
use tauri::{AppHandle, Manager, State, WebviewWindow, Window, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

pub const STATE_FLAGS: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED);
const SAVE_DEBOUNCE: Duration = Duration::from_millis(250);

pub struct WindowLifecycle {
    ready: AtomicBool,
    save_requests: Sender<()>,
}

pub fn initialize(app: &AppHandle) {
    let (save_requests, receiver) = mpsc::channel();
    app.manage(WindowLifecycle {
        ready: AtomicBool::new(false),
        save_requests,
    });
    let app = app.clone();
    std::thread::spawn(move || {
        while receiver.recv().is_ok() {
            loop {
                match receiver.recv_timeout(SAVE_DEBOUNCE) {
                    Ok(()) => continue,
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            // Closing to the tray saves synchronously before hiding the window.
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            match window.is_visible() {
                Ok(true) => save_state(&app),
                Ok(false) => {}
                Err(error) => {
                    log::warn!("Could not check window visibility before saving: {error}")
                }
            }
        }
    });
}

pub fn is_ready<R: tauri::Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<WindowLifecycle>()
        .is_some_and(|lifecycle| lifecycle.ready.load(Ordering::Acquire))
}

pub fn restore_main_window(app: &AppHandle) -> Result<(), String> {
    if !is_ready(app) {
        return Ok(());
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is unavailable".to_owned())?;
    window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
        .map_err(|error| format!("Could not restore main window: {error}"))
}

fn should_hide(visible: bool, minimized: bool) -> bool {
    visible && !minimized
}

pub fn toggle_main_window(app: &AppHandle) -> Result<(), String> {
    if !is_ready(app) {
        return Ok(());
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is unavailable".to_owned())?;
    let visible = window
        .is_visible()
        .map_err(|error| format!("Could not check main window visibility: {error}"))?;
    let minimized = window
        .is_minimized()
        .map_err(|error| format!("Could not check main window minimization: {error}"))?;
    if should_hide(visible, minimized) {
        save_state(app);
        window
            .hide()
            .map_err(|error| format!("Could not hide main window: {error}"))
    } else {
        restore_main_window(app)
    }
}

fn save_state(app: &AppHandle) {
    if let Err(error) = app.save_window_state(STATE_FLAGS) {
        log::warn!("Could not persist window state: {error}");
    }
}

#[tauri::command]
pub async fn show_main_window(
    window: WebviewWindow,
    lifecycle: State<'_, WindowLifecycle>,
) -> Result<(), String> {
    if window.label() != "main" || lifecycle.ready.load(Ordering::Acquire) {
        return Ok(());
    }
    // On Windows, restoring maximization can show even an initially hidden window.
    // Only restore after the frontend has completed its first painted frame.
    window
        .restore_state(STATE_FLAGS)
        .and_then(|_| window.show())
        .and_then(|_| window.set_focus())
        .map_err(|error| format!("Could not restore and show main window: {error}"))?;
    lifecycle.ready.store(true, Ordering::Release);
    Ok(())
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" || !is_ready(window.app_handle()) {
        return;
    }
    match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let lifecycle = window.state::<WindowLifecycle>();
            if let Err(error) = lifecycle.save_requests.send(()) {
                log::warn!("Could not schedule window state persistence: {error}");
            }
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            save_state(window.app_handle());
            match window.state::<SettingsState>().close_behavior() {
                CloseBehavior::Tray => {
                    // Keep the existing UI state when closing to the tray.
                    if let Err(error) = window.hide() {
                        log::warn!("Could not hide main window: {error}");
                    }
                }
                CloseBehavior::Exit => window.app_handle().exit(0),
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_actions_wait_for_frontend_readiness() {
        let app = tauri::test::mock_builder()
            .build(tauri::generate_context!())
            .unwrap();
        assert!(!is_ready(app.handle()));
        let (save_requests, _receiver) = mpsc::channel();
        app.manage(WindowLifecycle {
            ready: AtomicBool::new(false),
            save_requests,
        });
        assert!(!is_ready(app.handle()));
        app.state::<WindowLifecycle>()
            .ready
            .store(true, Ordering::Release);
        assert!(is_ready(app.handle()));
    }

    #[test]
    fn toggle_hides_only_a_visible_non_minimized_window() {
        for (visible, minimized, hide) in [
            (true, false, true),
            (true, true, false),
            (false, false, false),
            (false, true, false),
        ] {
            assert_eq!(should_hide(visible, minimized), hide);
        }
    }
}
