use super::{is_ready, save_state, WindowLifecycle};
use crate::settings::{Locale, SettingsState};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

#[derive(Default, Debug, PartialEq)]
enum Phase {
    #[default]
    Available,
    Pending(u32),
    Releasing {
        reopen: bool,
    },
    Dormant,
}

#[derive(Default)]
pub struct LightweightState {
    pub(super) enabled: AtomicBool,
    phase: Mutex<Phase>,
    sequence: Mutex<u32>,
    #[cfg(windows)]
    placement: Mutex<Option<super::placement::Placement>>,
}

impl Phase {
    fn restore(&mut self) -> bool {
        if let Self::Releasing { reopen } = self {
            *reopen = true;
            return false;
        }
        *self = Self::Available;
        true
    }

    fn release(&mut self, request: u32) -> bool {
        if *self != Self::Pending(request) {
            return false;
        }
        *self = Self::Releasing { reopen: false };
        true
    }

    fn destroyed(&mut self) -> bool {
        let reopen = matches!(self, Self::Releasing { reopen: true });
        *self = Self::Dormant;
        reopen
    }
}

pub fn keep_alive(app: &AppHandle) -> bool {
    app.state::<LightweightState>()
        .phase
        .lock()
        .map(|phase| matches!(*phase, Phase::Releasing { .. } | Phase::Dormant))
        .unwrap_or_else(|error| {
            log::error!("Could not read lightweight window state: {error}");
            false
        })
}

pub fn report_error(app: &AppHandle, error: &str) {
    log::error!("event=window_lifecycle_failed error={error}");
    let locale = app
        .state::<SettingsState>()
        .get()
        .map(|s| s.locale)
        .unwrap_or_default();
    app.dialog()
        .message(match locale {
            Locale::ZhCn => "窗口操作失败",
            Locale::En => "Window operation failed",
        })
        .title("NewBee")
        .show(|_| {});
}

pub fn request(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Err(error) = request_on_main(&handle) {
            report_error(&handle, &error);
        }
    })
    .map_err(|error| error.to_string())
}

fn request_on_main(app: &AppHandle) -> Result<(), String> {
    if !is_ready(app) {
        return Ok(());
    }
    let state = app.state::<LightweightState>();
    if !state.enabled.load(Ordering::Acquire) {
        save_state(app);
        if let Some(window) = app.get_webview_window("main") {
            window.hide().map_err(|error| error.to_string())?;
        }
        return Err("Lightweight mode listeners are unavailable".into());
    }
    let request = {
        let mut phase = state.phase.lock().map_err(|e| e.to_string())?;
        if *phase != Phase::Available {
            return Ok(());
        }
        let mut sequence = state.sequence.lock().map_err(|e| e.to_string())?;
        *sequence = sequence.wrapping_add(1);
        *phase = Phase::Pending(*sequence);
        *sequence
    };
    let window = app
        .get_webview_window("main")
        .ok_or("Main window is unavailable")?;
    if let Err(error) = window.emit("lightweight-requested", request) {
        *state.phase.lock().map_err(|e| e.to_string())? = Phase::Available;
        save_state(app);
        if let Err(hide_error) = window.hide() {
            log::warn!("Could not hide main window: {hide_error}");
        }
        return Err(error.to_string());
    }
    Ok(())
}

pub(super) fn restore(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<LightweightState>();
    if !state.phase.lock().map_err(|e| e.to_string())?.restore() {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window("main") {
        window
            .emit("lightweight-cancelled", ())
            .map_err(|e| e.to_string())?;
        if !is_ready(app) {
            return Ok(());
        }
        return window
            .show()
            .and_then(|_| window.unminimize())
            .and_then(|_| window.set_focus())
            .map_err(|e| format!("Could not restore main window: {e}"));
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "main")
        .ok_or("Main window configuration is unavailable")?;
    WebviewWindowBuilder::from_config(app, config)
        .and_then(|builder| builder.visible(false).build())
        .map_err(|e| format!("Could not rebuild main window: {e}"))?;
    Ok(())
}

pub(super) fn restore_placement(window: &WebviewWindow) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let state = window.state::<LightweightState>();
        let mut saved = state.placement.lock().map_err(|error| error.to_string())?;
        let Some(placement) = saved.as_ref() else {
            return Ok(false);
        };
        placement.restore(window)?;
        *saved = None;
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(false)
    }
}

pub(crate) fn destroyed(app: &AppHandle) {
    let lifecycle = app.state::<WindowLifecycle>();
    lifecycle.ready.store(false, Ordering::Release);
    lifecycle.prepared.store(false, Ordering::Release);
    let reopen = match app.state::<LightweightState>().phase.lock() {
        Ok(mut phase) => phase.destroyed(),
        Err(error) => {
            log::error!("Could not update destroyed window state: {error}");
            false
        }
    };
    if reopen {
        if let Err(error) = super::restore_main_window(app) {
            report_error(app, &error);
        }
    }
}

fn advance(app: &AppHandle, request: u32, release: bool) -> Result<bool, String> {
    let state = app.state::<LightweightState>();
    if *state.phase.lock().map_err(|e| e.to_string())? != Phase::Pending(request) {
        return Ok(false);
    }
    let window = app
        .get_webview_window("main")
        .ok_or("Main window is unavailable")?;
    if !release {
        #[cfg(windows)]
        {
            *state.placement.lock().map_err(|error| error.to_string())? =
                Some(super::placement::Placement::capture(&window)?);
        }
        save_state(app);
        window.hide().map_err(|e| e.to_string())?;
        return Ok(true);
    }
    if !state
        .phase
        .lock()
        .map_err(|e| e.to_string())?
        .release(request)
    {
        return Ok(false);
    }
    if let Err(error) = window.destroy() {
        *state.phase.lock().map_err(|e| e.to_string())? = Phase::Available;
        return Err(format!("Could not destroy main WebView: {error}"));
    }
    log::info!("event=lightweight_mode_entered");
    Ok(true)
}

#[tauri::command]
pub async fn advance_lightweight(
    window: WebviewWindow,
    request: u32,
    release: bool,
) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("Only the main window can enter lightweight mode".into());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (sender, receiver) = std::sync::mpsc::channel();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let result = advance(&handle, request, release);
            if result.is_err() {
                if let Ok(mut phase) = handle.state::<LightweightState>().phase.lock() {
                    *phase = Phase::Available;
                }
            }
            if sender.send(result).is_err() {
                log::debug!("Main WebView released before acknowledgement");
            }
        })
        .map_err(|e| e.to_string())?;
        receiver.recv().map_err(|e| e.to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_lightweight(
    window: WebviewWindow,
    request: u32,
    fallback: bool,
) -> Result<(), String> {
    let state = window.state::<LightweightState>();
    let mut phase = state.phase.lock().map_err(|e| e.to_string())?;
    if *phase == Phase::Pending(request) {
        *phase = Phase::Available;
        drop(phase);
        if fallback {
            save_state(window.app_handle());
            window.hide().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}
