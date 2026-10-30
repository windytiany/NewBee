mod state;

use crate::{backup, database, library, logging, playback, settings, shortcuts, window};
use state::{Progress, Snapshot};
use std::{sync::Mutex, time::Instant};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub(crate) struct StartupState(Mutex<Progress>);

pub fn initialize(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    logging::initialize(app.handle());
    // Read only: pending backup recovery still owns all writes to this directory.
    let preferences = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|path| settings::SettingsState::load(path.join("settings.json")).ok())
        .and_then(|state| state.get().ok())
        .unwrap_or_default();
    app.manage(StartupState(Mutex::new(Progress::new(
        preferences,
        Instant::now(),
    ))));
    window::initialize(app.handle());
    let splash = WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("splash.html".into()))
        .title("NewBee")
        .inner_size(280.0, 240.0)
        .decorations(false)
        .transparent(true)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .visible(false)
        .center()
        .build()?;
    #[cfg(windows)]
    window::prepare_borderless(&splash)?;
    #[cfg(not(windows))]
    let _ = splash;
    let app = app.handle().clone();
    std::thread::spawn(move || {
        let result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| initialize_backend(&app)))
                .unwrap_or_else(|_| Err("Backend initialization panicked".into()));
        let handle = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            let result = result.and_then(|restoring| {
                window::tray::initialize(&handle).map_err(|error| error.to_string())?;
                shortcuts::initialize(&handle, restoring);
                #[cfg(windows)]
                if let Err(error) = playback::media::initialize(&handle) {
                    log::warn!("Could not initialize Windows media controls: {error}");
                }
                Ok(())
            });
            let state = handle.state::<StartupState>();
            let mut progress = state.0.lock().unwrap();
            progress.backend_done = true;
            if progress.quitting() {
                drop(progress);
                handle.exit(0);
                return;
            }
            if let Err(error) = result {
                log::error!("event=application_setup_failed error={error}");
                progress.fail();
                return;
            }
            drop(progress);
            if let Err(error) = create_main_window(&handle) {
                report_failure(&handle, &error);
            }
        }) {
            report_failure(&app, &error.to_string());
        }
    });
    Ok(())
}

fn initialize_backend(app: &AppHandle) -> Result<bool, String> {
    let mut stage = "data_directory";
    let result = (|| {
        let app_data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&app_data_dir)?;
        stage = "restore";
        app.manage(backup::lock_data_directory(&app_data_dir)?);
        let restoring = match backup::apply_pending_restore(&app_data_dir) {
            Ok(restored) => restored,
            Err(error) => {
                backup::abort_pending_restore(&app_data_dir)?;
                log::error!("event=backup_restore_failed error={error}");
                app.state::<backup::BackupState>()
                    .report_restore_error(error)?;
                false
            }
        };
        stage = "database";
        let cache_directory = app.path().app_cache_dir()?.join("artwork");
        app.manage(database::Database::open_with_cache(
            app_data_dir.join("music-library.sqlite3"),
            &cache_directory,
        )?);
        stage = "settings";
        app.manage(settings::SettingsState::load(
            app_data_dir.join("settings.json"),
        )?);
        let settings = app.state::<settings::SettingsState>().get()?;
        app.state::<StartupState>().0.lock().unwrap().settings = settings.clone();
        app.state::<playback::PlaybackState>()
            .set_replay_gain(settings.replay_gain, settings.replay_gain_preamp);
        app.state::<playback::PlaybackState>()
            .set_playback_fades(settings.playback_fade_in, settings.playback_fade_out);
        stage = "library_synchronization";
        library::synchronization::initialize(app)?;
        stage = "playback_statistics";
        playback::statistics::initialize(app);
        stage = "playback_session";
        playback::session::initialize(app, app_data_dir.join("playback-session.json"))?;
        Ok::<_, Box<dyn std::error::Error>>(restoring)
    })();
    result.map_err(|error| format!("{stage}: {error}"))
}

fn create_main_window(app: &AppHandle) -> Result<(), String> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "main")
        .ok_or("Main window configuration is unavailable")?;
    WebviewWindowBuilder::from_config(app, config)
        .and_then(|builder| builder.visible(false).build())
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn report_failure(app: &AppHandle, error: &str) {
    log::error!("event=application_startup_failed error={error}");
    if let Ok(mut progress) = app.state::<StartupState>().0.lock() {
        progress.fail();
    }
}

pub fn ensure_active(app: &AppHandle) -> Result<(), String> {
    if app
        .state::<StartupState>()
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .can_show()
    {
        Ok(())
    } else {
        Err("Application startup is no longer active".into())
    }
}

pub fn complete(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<StartupState>();
    let mut progress = state.0.lock().map_err(|error| error.to_string())?;
    if !progress.complete() {
        return Err("Application startup is no longer active".into());
    }
    drop(progress);
    if let Some(splash) = app.get_webview_window("splash") {
        if let Err(error) = splash.destroy() {
            log::warn!("Could not destroy splash window: {error}");
            let _ = splash.hide();
        }
    }
    Ok(())
}

pub fn intercept_exit(app: &AppHandle) -> bool {
    app.state::<StartupState>().0.lock().unwrap().request_exit()
}

fn require_splash(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "splash" {
        Ok(())
    } else {
        Err("Only the splash window can control startup".into())
    }
}

#[tauri::command]
pub fn startup_status(window: WebviewWindow) -> Result<Snapshot, String> {
    require_splash(&window)?;
    Ok(window
        .state::<StartupState>()
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .snapshot(Instant::now()))
}

#[tauri::command]
pub async fn present_splash(window: WebviewWindow) -> Result<(), String> {
    require_splash(&window)?;
    let app = window.app_handle().clone();
    // Serialize visibility with main-window completion, so a delayed polling
    // response cannot resurrect the splash after startup has completed.
    window
        .run_on_main_thread(move || {
            let state = app.state::<StartupState>();
            let mut progress = state.0.lock().unwrap();
            if progress.should_present(Instant::now()) {
                if let Some(splash) = app.get_webview_window("splash") {
                    let _ = splash.show();
                }
            } else if let Some(splash) = app.get_webview_window("splash") {
                let _ = splash.hide();
            }
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn continue_startup(window: WebviewWindow) -> Result<(), String> {
    require_splash(&window)?;
    window
        .state::<StartupState>()
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .continue_waiting(Instant::now());
    Ok(())
}

#[tauri::command]
pub fn exit_startup(window: WebviewWindow) -> Result<(), String> {
    require_splash(&window)?;
    window.app_handle().exit(0);
    Ok(())
}

#[tauri::command]
pub fn fail_startup(window: WebviewWindow, error: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can report startup failure".into());
    }
    report_failure(window.app_handle(), &error);
    if window.app_handle().get_webview_window("splash").is_none() {
        window::lightweight::report_error(window.app_handle(), &error);
    }
    Ok(())
}
