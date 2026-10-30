pub(crate) mod lightweight;
#[cfg(windows)]
mod placement;
pub(crate) mod tray;

#[cfg(windows)]
pub(crate) use placement::prepare_borderless;

use crate::settings::{CloseBehavior, SettingsState};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Sender},
    },
    time::Duration,
};
use tauri::{AppHandle, Manager, WebviewWindow, Window, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

pub const STATE_FLAGS: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED);
const SAVE_DEBOUNCE: Duration = Duration::from_millis(250);

pub struct WindowLifecycle {
    ready: AtomicBool,
    prepared: AtomicBool,
    save_requests: Sender<()>,
}

pub fn initialize(app: &AppHandle) {
    let (save_requests, receiver) = mpsc::channel();
    app.manage(lightweight::LightweightState::default());
    app.manage(WindowLifecycle {
        ready: AtomicBool::new(false),
        prepared: AtomicBool::new(false),
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
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Err(error) = lightweight::restore(&handle) {
            lightweight::report_error(&handle, &error);
        }
    })
    .map_err(|error| error.to_string())
}

fn should_hide(visible: bool, minimized: bool) -> bool {
    visible && !minimized
}

pub fn toggle_main_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window("main").is_none() {
        return restore_main_window(app);
    }
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

async fn on_main_thread(
    window: WebviewWindow,
    action: impl FnOnce(WebviewWindow) -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can change its startup visibility".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (sender, receiver) = mpsc::channel();
        let app = window.app_handle().clone();
        app.run_on_main_thread(move || {
            let _ = sender.send(action(window));
        })
        .map_err(|error| error.to_string())?;
        receiver.recv().map_err(|error| error.to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn prepare_main_window(window: WebviewWindow) -> Result<(), String> {
    on_main_thread(window, |window| {
        let lifecycle = window.state::<WindowLifecycle>();
        if lifecycle.prepared.load(Ordering::Acquire) {
            return Ok(());
        }
        // Maximizing a hidden HWND can make it visible. DWM cloaking keeps it
        // off screen while Windows and the WebView settle at the final size.
        #[cfg(windows)]
        placement::cloak(&window, true)?;
        if !lightweight::restore_placement(&window)? {
            window
                .restore_state(STATE_FLAGS)
                .map_err(|error| error.to_string())?;
        }
        #[cfg(windows)]
        window
            .show()
            .and_then(|_| window.unminimize())
            .map_err(|error| error.to_string())?;
        lifecycle.prepared.store(true, Ordering::Release);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn show_main_window(
    window: WebviewWindow,
    lightweight_ready: Option<bool>,
) -> Result<(), String> {
    on_main_thread(window, move |window| {
        let lifecycle = window.state::<WindowLifecycle>();
        if lifecycle.ready.load(Ordering::Acquire) {
            return Ok(());
        }
        if !lifecycle.prepared.load(Ordering::Acquire) {
            return Err("Main window layout has not been prepared".into());
        }
        // Completion and splash presentation are serialized on the UI thread.
        crate::startup::ensure_active(window.app_handle())?;
        window
            .show()
            .and_then(|_| window.unminimize())
            .map_err(|error| error.to_string())?;
        #[cfg(windows)]
        placement::cloak(&window, false)?;
        window.set_focus().map_err(|error| error.to_string())?;
        crate::startup::complete(window.app_handle())?;
        window
            .state::<lightweight::LightweightState>()
            .enabled
            .store(lightweight_ready.unwrap_or(false), Ordering::Release);
        lifecycle.ready.store(true, Ordering::Release);
        Ok(())
    })
    .await
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() == "splash" {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            window.app_handle().exit(0);
        }
        return;
    }
    if window.label() != "main" {
        return;
    }
    if matches!(event, WindowEvent::Destroyed) {
        return;
    }
    if !is_ready(window.app_handle()) {
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
                    let lightweight = window
                        .state::<SettingsState>()
                        .get()
                        .map(|settings| settings.lightweight_on_close)
                        .unwrap_or_else(|error| {
                            log::warn!("Could not read lightweight setting: {error}");
                            false
                        });
                    let result = if lightweight {
                        lightweight::request(window.app_handle())
                    } else {
                        window.hide().map_err(|error| error.to_string())
                    };
                    if let Err(error) = result {
                        lightweight::report_error(window.app_handle(), &error);
                    }
                }
                CloseBehavior::Exit => window.app_handle().exit(0),
            }
        }
        _ => {}
    }
}
