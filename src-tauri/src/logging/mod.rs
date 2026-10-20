pub(crate) mod aggregation;
pub(crate) mod export;
mod record;

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use tauri_plugin_opener::OpenerExt;

const MAX_FILE_BYTES: u128 = 5 * 1024 * 1024;
const ARCHIVE_COUNT: usize = 5;
static DETAILED: AtomicBool = AtomicBool::new(false);

thread_local! {
    static OPERATION: RefCell<Option<String>> = const { RefCell::new(None) };
}

pub(crate) fn with_operation<T>(id: Option<String>, action: impl FnOnce() -> T) -> T {
    struct Restore(Option<String>);
    impl Drop for Restore {
        fn drop(&mut self) {
            OPERATION.with(|current| *current.borrow_mut() = self.0.take());
        }
    }
    let id = id.map(|id| {
        id.chars()
            .filter(|c| c.is_ascii_alphanumeric() || ":-_".contains(*c))
            .take(120)
            .collect()
    });
    let _restore = Restore(OPERATION.with(|current| current.replace(id)));
    action()
}

fn enabled(level: log::Level) -> bool {
    level <= log::Level::Info || DETAILED.load(Ordering::Relaxed)
}

// Match common credential formats, not arbitrary text or local music paths.
pub(crate) fn redact_text(text: &str) -> String {
    static PATTERNS: std::sync::LazyLock<Vec<regex::Regex>> = std::sync::LazyLock::new(|| {
        [
            r#"(?i)(\bAuthorization\s*\\?["']?\s*[:=]\s*\\?["']?)(?:Bearer|Basic)\s+[^\s"',;]+"#,
            r#"(?i)(\bBearer\s+)[^\s"',;]+"#,
            r#"(?i)([a-z][a-z0-9+.-]*://)[^\s/@]+@"#,
            r#"(?i)(\b(?:token|access_token|refresh_token|api_key|api-key|apikey|password|passwd|client_secret)\b\\?["']?\s*[:=]\s*)(?:\\?"[^"\r\n]*"|\\?'[^'\r\n]*'|[^\s&"',;}]+)"#,
        ].into_iter().map(|pattern| regex::Regex::new(pattern).expect("valid credential pattern")).collect()
    });
    let mut text = text.to_owned();
    for (index, pattern) in PATTERNS.iter().enumerate() {
        text = pattern
            .replace_all(
                &text,
                if index == 2 {
                    "${1}[REDACTED]@"
                } else {
                    "${1}[REDACTED]"
                },
            )
            .into_owned();
    }
    text
}

fn builder(session: u128) -> tauri_plugin_log::Builder {
    tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Debug)
        .filter(|metadata| {
            enabled(metadata.level())
                && (metadata.target().starts_with("newbee_lib")
                    || metadata.target().starts_with("webview"))
        })
        .max_file_size(MAX_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(ARCHIVE_COUNT))
        .targets([Target::new(TargetKind::LogDir {
            file_name: Some("newbee".into()),
        })])
        .format(move |out, message, record| {
            let time = TimezoneStrategy::UseUtc.get_now().to_string();
            OPERATION.with(|operation| {
                let text = record::format(
                    session,
                    &time,
                    record.level(),
                    record.target(),
                    operation.borrow().as_deref(),
                    &message.to_string(),
                );
                out.finish(format_args!("{text}"));
            });
        })
}

pub(crate) fn initialize(app: &tauri::AppHandle) {
    let session = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let plugin = builder(session).build();
    if let Ok(path) = app.path().app_log_dir() {
        start_retention(path);
    }
    install(app, plugin);
    log::info!(
        "event=application_started version={}",
        app.package_info().version
    );
}

fn install<R: tauri::Runtime>(app: &tauri::AppHandle<R>, plugin: tauri::plugin::TauriPlugin<R>) {
    // A read-only/unavailable log directory must not prevent the app from starting.
    if let Err(error) = app.plugin(plugin) {
        eprintln!(
            "Could not initialize diagnostic logging: {}",
            redact_text(&error.to_string())
        );
    }
}

#[tauri::command]
pub(crate) fn set_detailed_logging(enabled: bool) {
    DETAILED.store(enabled, Ordering::Relaxed);
    log::info!("event=logging_level_changed detailed={enabled}");
    log::debug!("event=detailed_logging_enabled");
}

#[tauri::command]
pub(crate) async fn open_logs_directory(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = app
            .path()
            .app_log_dir()
            .map_err(|error| error.to_string())?;
        std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn prune_archives(path: &std::path::Path) -> std::io::Result<()> {
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let mut archives = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("newbee_") || !(name.ends_with(".log") || name.ends_with(".log.bak")) {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        if metadata.is_file() {
            archives.push((entry.path(), metadata.modified()?, name));
        }
    }
    archives.sort_by(|left, right| (&left.1, &left.2).cmp(&(&right.1, &right.2)));
    let remove_count = archives.len().saturating_sub(ARCHIVE_COUNT);
    for (file, _, _) in archives.into_iter().take(remove_count) {
        match std::fs::remove_file(file) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error),
            _ => {}
        }
    }
    Ok(())
}

fn start_retention(path: std::path::PathBuf) {
    // The plugin's second-resolution archive names can create .log.bak on collisions.
    // KeepSome excludes those backups, so also bound them without replacing its writer.
    if let Err(error) = prune_archives(&path) {
        eprintln!(
            "Could not prune diagnostic archives: {}",
            redact_text(&error.to_string())
        );
    }
    if let Err(error) = std::thread::Builder::new()
        .name("log-retention".into())
        .spawn(move || {
            let mut failure = RepeatedFailure::default();
            loop {
                std::thread::sleep(Duration::from_secs(60));
                let result = prune_archives(&path);
                let error = result.err().map(|error| error.to_string());
                failure.report("logging.retention", error.as_deref());
            }
        })
    {
        eprintln!(
            "Could not schedule diagnostic archive pruning: {}",
            redact_text(&error.to_string())
        );
    }
}

#[derive(Default)]
pub(crate) struct RepeatedFailure {
    last_report: Option<Instant>,
    suppressed: usize,
    reason: Option<String>,
}

impl RepeatedFailure {
    fn observe(&mut self, failed: bool, now: Instant) -> Option<(bool, usize)> {
        if failed {
            if self
                .last_report
                .is_some_and(|last| now.duration_since(last) < Duration::from_secs(30))
            {
                self.suppressed += 1;
                return None;
            }
            self.last_report = Some(now);
            return Some((true, std::mem::take(&mut self.suppressed)));
        }
        self.last_report
            .take()
            .map(|_| (false, std::mem::take(&mut self.suppressed)))
    }

    pub(crate) fn report(&mut self, module: &str, error: Option<&str>) {
        if error.is_some() && error != self.reason.as_deref() {
            if self.suppressed > 0 {
                log::warn!(
                    "{}",
                    serde_json::json!({"event":"repeated_failure_summary", "module":module, "suppressed":self.suppressed, "error":self.reason})
                );
            }
            self.last_report = None;
            self.suppressed = 0;
        }
        self.reason = error.map(str::to_owned);
        match self.observe(error.is_some(), Instant::now()) {
            Some((true, suppressed)) => log::warn!(
                "{}",
                serde_json::json!({"event":"repeated_failure", "module":module, "suppressed":suppressed, "error":error})
            ),
            Some((false, suppressed)) => log::info!(
                "{}",
                serde_json::json!({"event":"recovered", "module":module, "suppressed":suppressed})
            ),
            None => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    static LEVEL_TEST: std::sync::Mutex<()> = std::sync::Mutex::new(());
    static ACTIVE_LOGGER: std::sync::Mutex<Option<Box<dyn log::Log>>> = std::sync::Mutex::new(None);
    static FORWARDER: Forwarder = Forwarder;

    struct Forwarder;
    impl log::Log for Forwarder {
        fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
            ACTIVE_LOGGER
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|logger| logger.enabled(metadata))
        }
        fn log(&self, record: &log::Record<'_>) {
            if let Some(logger) = ACTIVE_LOGGER.lock().unwrap().as_ref() {
                logger.log(record);
            }
        }
        fn flush(&self) {
            if let Some(logger) = ACTIVE_LOGGER.lock().unwrap().as_ref() {
                logger.flush();
            }
        }
    }
    struct ActiveLogging;
    impl Drop for ActiveLogging {
        fn drop(&mut self) {
            ACTIVE_LOGGER.lock().unwrap().take();
        }
    }

    fn invoke_log(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        level: u8,
        message: &str,
    ) {
        let response = tauri::test::get_ipc_response(
            webview,
            tauri::webview::InvokeRequest {
                cmd: "plugin:log|log".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({
                    "level": level, "message": message, "location": "logging-test"
                })),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        );
        assert!(response.is_ok(), "log IPC failed: {response:?}");
        log::logger().flush();
    }

    struct Directory(std::path::PathBuf);
    impl Directory {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("newbee-logs-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn emit(logger: &dyn log::Log, level: log::Level, target: &str, message: &str) {
        logger.log(
            &log::Record::builder()
                .args(format_args!("{message}"))
                .level(level)
                .target(target)
                .build(),
        );
        logger.flush();
    }
    fn folder(path: &std::path::Path) -> Target {
        Target::new(TargetKind::Folder {
            path: path.to_owned(),
            file_name: Some("newbee".into()),
        })
    }

    #[test]
    fn plugin_writes_both_sources_with_session_operation_and_runtime_level() {
        let _guard = LEVEL_TEST.lock().unwrap();
        DETAILED.store(false, Ordering::Relaxed);
        let directory = Directory::new();
        let app = tauri::test::mock_builder()
            .build(tauri::generate_context!())
            .unwrap();
        let (plugin, max_level, logger) = builder(42)
            .targets([folder(&directory.0)])
            .split(app.handle())
            .unwrap();
        *ACTIVE_LOGGER.lock().unwrap() = Some(logger);
        let _logging = ActiveLogging;
        log::set_logger(&FORWARDER).unwrap();
        log::set_max_level(max_level);
        app.handle().plugin(plugin).unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        with_operation(Some("save:1".into()), || {
            log::info!(target: "newbee_lib::metadata", "event=saved fileWritten=true databaseUpdated=false");
        });
        invoke_log(&webview, 3, "frontend-marker");
        invoke_log(&webview, 2, "hidden-frontend-debug");
        log::debug!(target: "newbee_lib::playback", "hidden-debug");
        log::info!(target: "reqwest", "excluded-third-party");
        set_detailed_logging(true);
        log::debug!(target: "newbee_lib::playback", "visible-debug");
        invoke_log(&webview, 2, "visible-frontend-debug");
        set_detailed_logging(false);
        log::debug!(target: "newbee_lib::playback", "hidden-again");
        invoke_log(&webview, 2, "hidden-frontend-again");
        let text = std::fs::read_to_string(directory.0.join("newbee.log")).unwrap();
        let records: Vec<serde_json::Value> = text
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert!(records.iter().any(|record| record["source"] == "rust"
            && record["module"] == "newbee_lib::metadata"
            && record["sessionId"] == "42"
            && record["operationId"] == "save:1"));
        assert!(records.iter().any(|record| record["source"] == "frontend"
            && record["module"] == "webview::logging-test"
            && record["sessionId"] == "42"));
        assert!(text.contains("fileWritten=true databaseUpdated=false"));
        assert!(text.contains("frontend-marker"));
        assert!(text.contains("visible-debug"));
        assert!(text.contains("visible-frontend-debug"));
        assert!(!text.contains("hidden-frontend-debug"));
        assert!(!text.contains("hidden-frontend-again"));
        assert!(!text.contains("hidden-debug"));
        assert!(!text.contains("hidden-again"));
        assert!(!text.contains("excluded-third-party"));
    }

    #[test]
    fn redacts_credentials_in_rust_format_without_hiding_music_paths() {
        let directory = Directory::new();
        let app = tauri::test::mock_app();
        let (_, _, logger) = builder(42)
            .targets([folder(&directory.0)])
            .split(app.handle())
            .unwrap();
        let error = r#"Authorization: Bearer auth-secret Bearer bare-secret https://alice:url-secret@example.com/music?token=query-secret&api_key=api-secret password="two word secret" {"access_token":"json-secret"} C:/Music/song.flac"#;
        emit(
            logger.as_ref(),
            log::Level::Error,
            "newbee_lib::startup",
            &format!("error={error:?}"),
        );
        let text = std::fs::read_to_string(directory.0.join("newbee.log")).unwrap();
        for secret in [
            "auth-secret",
            "bare-secret",
            "alice",
            "url-secret",
            "query-secret",
            "api-secret",
            "two word secret",
            "json-secret",
        ] {
            assert!(!text.contains(secret), "leaked {secret}: {text}");
        }
        assert!(text.contains("[REDACTED]"));
        assert!(text.contains("C:/Music/song.flac"));
        assert!(text.contains("example.com/music"));
    }

    #[test]
    fn bounds_rotated_files_including_same_second_backups() {
        let directory = Directory::new();
        let app = tauri::test::mock_app();
        let (_, _, logger) = builder(42)
            .max_file_size(512)
            .targets([folder(&directory.0)])
            .split(app.handle())
            .unwrap();
        for _ in 0..40 {
            emit(
                logger.as_ref(),
                log::Level::Info,
                "webview",
                &"x".repeat(100),
            );
        }
        drop(logger);
        let rotated = std::fs::read_dir(&directory.0)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("newbee_")
            })
            .collect::<Vec<_>>();
        assert!(
            !rotated.is_empty(),
            "writing over the limit must really rotate the plugin output"
        );
        assert!(rotated.iter().any(|path| std::fs::read_to_string(path)
            .unwrap()
            .contains("xxxxxxxxxx")));
        assert!(std::fs::read_to_string(directory.0.join("newbee.log"))
            .unwrap()
            .contains("xxxxxxxxxx"));
        for index in 0..10 {
            std::fs::write(
                directory
                    .0
                    .join(format!("newbee_2000-01-01_00-00-{index:02}.log.bak")),
                "archive",
            )
            .unwrap();
            let file = std::fs::File::options()
                .write(true)
                .open(
                    directory
                        .0
                        .join(format!("newbee_2000-01-01_00-00-{index:02}.log.bak")),
                )
                .unwrap();
            file.set_times(
                std::fs::FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(index + 1)),
            )
            .unwrap();
        }
        std::fs::write(directory.0.join("unrelated.log"), "keep").unwrap();
        prune_archives(&directory.0).unwrap();
        let files = std::fs::read_dir(&directory.0)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect::<Vec<_>>();
        assert_eq!(
            files
                .iter()
                .filter(|path| path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("newbee_"))
                .count(),
            ARCHIVE_COUNT
        );
        assert!(directory.0.join("newbee.log").exists());
        assert!(directory.0.join("unrelated.log").exists());
        assert!(!directory
            .0
            .join("newbee_2000-01-01_00-00-00.log.bak")
            .exists());
        assert!(rotated.iter().all(|path| path.exists()));
        assert!(files
            .iter()
            .all(|path| path.metadata().unwrap().len() <= 512));
    }

    #[test]
    fn unavailable_log_directory_returns_an_error_without_panicking() {
        let directory = Directory::new();
        let unavailable = directory.0.join("not-a-directory");
        std::fs::write(&unavailable, "occupied").unwrap();
        let app = tauri::test::mock_app();
        assert!(builder(42)
            .targets([folder(&unavailable)])
            .split(app.handle())
            .is_err());
        assert!(prune_archives(&unavailable).is_err());
        install(
            app.handle(),
            builder(42).targets([folder(&unavailable)]).build(),
        );
        // Startup proceeds beyond the same non-fatal plugin installation used in initialize.
        assert_eq!(std::fs::read_to_string(&unavailable).unwrap(), "occupied");
        assert!(app.path().app_log_dir().is_ok());
    }
    #[cfg(windows)]
    #[test]
    fn rotation_write_failure_does_not_interrupt_the_caller() {
        use std::os::windows::fs::OpenOptionsExt;

        let directory = Directory::new();
        let path = directory.0.join("logs");
        let app = tauri::test::mock_app();
        let (_, _, logger) = builder(42)
            .max_file_size(512)
            .targets([folder(&path)])
            .split(app.handle())
            .unwrap();
        emit(logger.as_ref(), log::Level::Info, "webview", "first-marker");
        // Allow reads/writes but deny deletion. Rotation closes the writer, then
        // its actual rename fails because this second handle remains open.
        let active = path.join("newbee.log");
        let _lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(&active)
            .unwrap();
        emit(
            logger.as_ref(),
            log::Level::Info,
            "webview",
            &"x".repeat(500),
        );
        let text = std::fs::read_to_string(&active).unwrap();
        assert!(text.contains("first-marker"));
        assert!(
            !text.contains("xxxxxxxxxx"),
            "the oversized record must fail to rotate/write"
        );
        // The business operation can still finish after a failed log write.
        std::fs::write(directory.0.join("business-result"), "saved").unwrap();
        assert_eq!(
            std::fs::read_to_string(directory.0.join("business-result")).unwrap(),
            "saved"
        );
    }

    #[test]
    fn repeated_failures_report_first_periodic_summary_and_recovery() {
        let mut failure = RepeatedFailure::default();
        let now = Instant::now();
        assert_eq!(failure.observe(true, now), Some((true, 0)));
        assert_eq!(failure.observe(true, now + Duration::from_secs(1)), None);
        assert_eq!(
            failure.observe(true, now + Duration::from_secs(30)),
            Some((true, 1))
        );
        assert_eq!(failure.observe(true, now + Duration::from_secs(31)), None);
        assert_eq!(
            failure.observe(false, now + Duration::from_secs(32)),
            Some((false, 1))
        );
        assert_eq!(failure.observe(false, now + Duration::from_secs(33)), None);
    }

    #[test]
    fn different_repeated_failure_reasons_are_reported_immediately() {
        let mut failure = RepeatedFailure::default();
        failure.report("playback", Some("permission denied"));
        failure.report("playback", Some("permission denied"));
        assert_eq!(failure.suppressed, 1);
        failure.report("playback", Some("device disconnected"));
        assert_eq!(failure.suppressed, 0);
        assert_eq!(failure.reason.as_deref(), Some("device disconnected"));
    }

    #[test]
    fn operation_context_is_scoped_and_restored() {
        with_operation(Some("scan:1".into()), || {
            OPERATION.with(|id| assert_eq!(id.borrow().as_deref(), Some("scan:1")));
            with_operation(Some("nested\n2".into()), || {
                OPERATION.with(|id| assert_eq!(id.borrow().as_deref(), Some("nested2")));
            });
            OPERATION.with(|id| assert_eq!(id.borrow().as_deref(), Some("scan:1")));
        });
        OPERATION.with(|id| assert!(id.borrow().is_none()));
    }

    #[test]
    fn defaults_to_info_and_detailed_switch_is_runtime_only() {
        let _guard = LEVEL_TEST.lock().unwrap();
        assert!(!enabled(log::Level::Debug));
        assert!(enabled(log::Level::Info));
        set_detailed_logging(true);
        assert!(enabled(log::Level::Debug));
        set_detailed_logging(false);
        assert!(!enabled(log::Level::Debug));
        assert_eq!(MAX_FILE_BYTES, 5 * 1024 * 1024);
        assert_eq!(ARCHIVE_COUNT, 5);
    }
}
