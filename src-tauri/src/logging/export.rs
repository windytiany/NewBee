use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashSet, VecDeque},
    fs::File,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};
use tauri::Manager;

const DEFAULT_BYTES: usize = 64 * 1024;
const MAX_BYTES: usize = 256 * 1024;
const MAX_LINE_BYTES: usize = 32 * 1024;
const MAX_RECORDS: usize = 1_000;
const HEADER_RESERVE: usize = 2_048;

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Options {
    level: Option<String>,
    module: Option<String>,
    operation_id: Option<String>,
    since: Option<u64>,
    until: Option<u64>,
    all_sessions: bool,
    include_context: bool,
    anonymize_paths: bool,
    max_bytes: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Excerpt {
    #[serde(skip_serializing)]
    content: String,
    records: usize,
    omitted: usize,
}

#[tauri::command]
pub(crate) async fn export_diagnostics(
    app: tauri::AppHandle,
    options: Options,
    destination: String,
) -> Result<Excerpt, String> {
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    log::logger().flush();
    tauri::async_runtime::spawn_blocking(move || {
        save(&directory, &data, Path::new(&destination), &options)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn save(
    directory: &Path,
    data: &Path,
    destination: &Path,
    options: &Options,
) -> Result<Excerpt, String> {
    let parent = destination
        .parent()
        .ok_or("无效的导出路径")?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let resolved = if destination.exists() {
        destination
            .canonicalize()
            .map_err(|error| error.to_string())?
    } else {
        parent.join(destination.file_name().ok_or("无效的导出路径")?)
    };
    for protected in [directory, data] {
        if protected
            .canonicalize()
            .is_ok_and(|path| resolved.starts_with(path))
        {
            return Err("不能覆盖应用数据或日志".into());
        }
    }
    let excerpt = collect(directory, options)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    std::io::Write::write_all(&mut file, excerpt.content.as_bytes())
        .map_err(|error| error.to_string())?;
    file.persist(destination)
        .map_err(|error| error.to_string())?;
    Ok(excerpt)
}

fn files(directory: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(error.to_string()),
    };
    let mut files = vec![];
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name != "newbee.log"
            && !(name.starts_with("newbee_")
                && (name.ends_with(".log") || name.ends_with(".log.bak")))
        {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
        };
        if metadata.is_file() {
            files.push((
                name == "newbee.log",
                metadata.modified().map_err(|error| error.to_string())?,
                name,
                entry.path(),
            ));
        }
    }
    files.sort_by(|a, b| (&a.0, &a.1, &a.2).cmp(&(&b.0, &b.1, &b.2)));
    Ok(files.into_iter().map(|(_, _, _, path)| path).collect())
}

// Oversized lines are consumed without allocating their full length.
fn visit(files: &[PathBuf], mut action: impl FnMut(Option<Value>)) -> Result<(), String> {
    for path in files {
        let file = match File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
        };
        let length = file.metadata().map_err(|error| error.to_string())?.len();
        let mut reader = BufReader::new(std::io::Read::take(file, length));
        let mut line = Vec::new();
        let mut oversized = false;
        loop {
            let buffer = reader.fill_buf().map_err(|error| error.to_string())?;
            if buffer.is_empty() {
                if !line.is_empty() || oversized {
                    action(None);
                }
                break;
            }
            let end = buffer
                .iter()
                .position(|byte| *byte == b'\n')
                .map(|index| index + 1);
            let length = end.unwrap_or(buffer.len());
            if !oversized {
                if line.len() + length > MAX_LINE_BYTES {
                    oversized = true;
                    line.clear();
                } else {
                    line.extend_from_slice(&buffer[..length]);
                }
            }
            reader.consume(length);
            if end.is_some() {
                action(if oversized {
                    None
                } else {
                    parse(&String::from_utf8_lossy(&line))
                });
                line.clear();
                oversized = false;
            }
        }
    }
    Ok(())
}

fn parse(line: &str) -> Option<Value> {
    if let Ok(value) = serde_json::from_str::<Value>(line) {
        return (value.is_object()
            && value["level"].as_str().and_then(severity).is_some()
            && value["sessionId"].as_str().is_none_or(|id| id.len() <= 120))
        .then_some(value);
    }
    // Existing text logs remain exportable after upgrading.
    let level = legacy_field(line, "level=")?;
    let module = legacy_field(line, "module=").unwrap_or_default();
    let session = legacy_field(line, "sessionId=").unwrap_or_default();
    if session.len() > 120 || severity(level).is_none() {
        return None;
    }
    let operation = line
        .split_once("operationId=Some(\"")
        .and_then(|(_, tail)| tail.split_once("\")"))
        .map(|(id, _)| id);
    let payload = line
        .find("{\"source\"")
        .and_then(|offset| serde_json::from_str::<Value>(line[offset..].trim()).ok());
    let mut value = payload.unwrap_or_else(|| json!({"message":line.trim()}));
    value["level"] = json!(level);
    if value.get("module").is_none() {
        value["module"] = json!(module);
    }
    value["sessionId"] = json!(session);
    if let Some(operation) = operation {
        value["operationId"] = json!(operation);
    }
    if let Some(time) = line
        .split_once("time=\"")
        .and_then(|(_, tail)| tail.split_once('"'))
        .map(|(time, _)| time)
    {
        value["time"] = json!(time);
        if let Some(timestamp) = legacy_timestamp(time) {
            value["timestamp"] = json!(timestamp);
        }
    }
    Some(value)
}

fn legacy_timestamp(text: &str) -> Option<u64> {
    let (date, tail) = text.split_once(' ')?;
    let (clock, offset) = tail.split_once(' ')?;
    if offset != "+00:00:00" {
        return None;
    }
    let date: Vec<_> = date.split('-').collect();
    let clock: Vec<_> = clock.split(':').collect();
    if date.len() != 3 || clock.len() != 3 {
        return None;
    }
    let (seconds, fraction) = clock[2].split_once('.').unwrap_or((clock[2], "0"));
    let fraction = format!("{fraction:0<9}");
    let time = tauri_plugin_log::TimezoneStrategy::UseUtc
        .get_now()
        .replace_day(1)
        .ok()?
        .replace_year(date[0].parse().ok()?)
        .ok()?
        .replace_month(date[1].parse::<u8>().ok()?.try_into().ok()?)
        .ok()?
        .replace_day(date[2].parse().ok()?)
        .ok()?
        .replace_hour(clock[0].parse().ok()?)
        .ok()?
        .replace_minute(clock[1].parse().ok()?)
        .ok()?
        .replace_second(seconds.parse().ok()?)
        .ok()?
        .replace_nanosecond(fraction.parse().ok()?)
        .ok()?;
    (time.unix_timestamp_nanos() / 1_000_000).try_into().ok()
}

fn legacy_field<'a>(line: &'a str, prefix: &str) -> Option<&'a str> {
    line.split_once(prefix)?.1.split_whitespace().next()
}

fn severity(level: &str) -> Option<u8> {
    match level.to_ascii_uppercase().as_str() {
        "DEBUG" => Some(0),
        "INFO" => Some(1),
        "WARN" => Some(2),
        "ERROR" => Some(3),
        _ => None,
    }
}

fn matches(record: &Value, options: &Options, session: Option<&str>) -> bool {
    if !options.all_sessions && record["sessionId"].as_str() != session {
        return false;
    }
    if let Some(module) = options.module.as_deref().filter(|s| !s.is_empty()) {
        if !record["module"]
            .as_str()
            .is_some_and(|value| value.contains(module))
        {
            return false;
        }
    }
    if let Some(operation) = options.operation_id.as_deref().filter(|s| !s.is_empty()) {
        if record["operationId"].as_str() != Some(operation) {
            return false;
        }
    }
    if let Some(since) = options.since {
        if !record["timestamp"]
            .as_u64()
            .is_some_and(|time| time >= since)
        {
            return false;
        }
    }
    if let Some(until) = options.until {
        if !record["timestamp"]
            .as_u64()
            .is_some_and(|time| time <= until)
        {
            return false;
        }
    }
    true
}

fn anonymize(value: &mut Value) {
    match value {
        Value::String(text) => {
            static PATHS: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
                regex::Regex::new(r#"(?i)(?:[a-z]:[\\/]|\\\\|(?:^|[\s\"'(:])/[^/\s])[^\r\n\"'<>]*"#)
                    .unwrap()
            });
            *text = PATHS.replace_all(text, "[PATH]").into_owned();
        }
        Value::Array(values) => values.iter_mut().for_each(anonymize),
        Value::Object(fields) => {
            for (key, value) in fields {
                if key == "path" {
                    *value = json!("[PATH]");
                } else if key == "samples" {
                    if let Some(samples) = value.as_array_mut() {
                        for sample in samples {
                            *sample = json!("[SUBJECT]");
                        }
                    }
                } else {
                    anonymize(value);
                }
            }
        }
        _ => {}
    }
}

struct Selected {
    index: usize,
    line: String,
    operation: Option<(String, String)>,
}

struct Selection {
    records: VecDeque<Selected>,
    bytes: usize,
    matched: usize,
    max_bytes: usize,
    max_records: usize,
}

fn operation(record: &Value) -> Option<(String, String)> {
    Some((
        record["sessionId"].as_str()?.to_owned(),
        record["operationId"].as_str()?.to_owned(),
    ))
}

impl Selection {
    fn new(max_bytes: usize, max_records: usize) -> Self {
        Self {
            records: VecDeque::new(),
            bytes: 0,
            matched: 0,
            max_bytes,
            max_records,
        }
    }

    fn retain(&mut self, mut record: Value, index: usize, options: &Options) {
        self.matched += 1;
        let operation = operation(&record);
        if options.anonymize_paths {
            anonymize(&mut record);
        }
        super::record::redact(&mut record);
        let line = record.to_string() + "\n";
        if line.len() > self.max_bytes || self.max_records == 0 {
            return;
        }
        while self.bytes + line.len() > self.max_bytes || self.records.len() >= self.max_records {
            if let Some(removed) = self.records.pop_front() {
                self.bytes -= removed.line.len();
            }
        }
        self.bytes += line.len();
        self.records.push_back(Selected {
            index,
            line,
            operation,
        });
    }
}

fn collect(directory: &Path, options: &Options) -> Result<Excerpt, String> {
    let minimum = severity(options.level.as_deref().unwrap_or("WARN")).ok_or("无效的日志等级")?;
    if options
        .since
        .zip(options.until)
        .is_some_and(|(since, until)| since > until)
    {
        return Err("无效的时间范围".into());
    }
    let budget = options
        .max_bytes
        .unwrap_or(DEFAULT_BYTES)
        .clamp(4_096, MAX_BYTES);
    let files = files(directory)?;
    let mut session = None;
    visit(&files, |record| {
        if let Some(id) = record
            .as_ref()
            .and_then(|record| record["sessionId"].as_str())
        {
            session = Some(id.to_owned());
        }
    })?;
    let mut primary = Selection::new(budget - HEADER_RESERVE, MAX_RECORDS);
    let mut unreadable = 0;
    let mut index = 0;
    visit(&files, |record| {
        index += 1;
        let Some(record) = record else {
            unreadable += 1;
            return;
        };
        if matches(&record, options, session.as_deref())
            && record["level"]
                .as_str()
                .and_then(severity)
                .is_some_and(|level| level >= minimum)
        {
            primary.retain(record, index, options);
        }
    })?;
    // Related INFO may use remaining space, but must never evict a problem record.
    let operations: HashSet<_> = primary
        .records
        .iter()
        .filter_map(|record| record.operation.clone())
        .collect();
    let mut context = Selection::new(
        budget - HEADER_RESERVE - primary.bytes,
        MAX_RECORDS - primary.records.len(),
    );
    if options.include_context && minimum > 1 && !operations.is_empty() {
        let mut index = 0;
        visit(&files, |record| {
            index += 1;
            let Some(record) = record else {
                return;
            };
            if matches(&record, options, session.as_deref())
                && record["level"] == "INFO"
                && operation(&record).is_some_and(|key| operations.contains(&key))
            {
                context.retain(record, index, options);
            }
        })?;
    }
    let matched = primary.matched + context.matched;
    let mut records: Vec<_> = primary.records.into_iter().chain(context.records).collect();
    records.sort_by_key(|record| record.index);
    let omitted = matched - records.len();
    let header = json!({"kind":"diagnostic_excerpt", "exporterVersion":env!("CARGO_PKG_VERSION"), "sessionId":session, "records":records.len(),
        "matched":matched, "omitted":omitted, "unreadableRecords":unreadable,
        "truncated":omitted > 0 || unreadable > 0,
        "maxBytes":budget, "selection":"latest", "priority":"minimumLevel", "allSessions":options.all_sessions,
        "minimumLevel":options.level.as_deref().unwrap_or("WARN"), "includeContext":options.include_context,
        "anonymizePaths":options.anonymize_paths}).to_string() + "\n";
    let count = records.len();
    Ok(Excerpt {
        content: header
            + &records
                .into_iter()
                .map(|record| record.line)
                .collect::<String>(),
        records: count,
        omitted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(directory: &Path, name: &str, values: &[Value]) {
        std::fs::write(
            directory.join(name),
            values
                .iter()
                .map(|value| value.to_string() + "\n")
                .collect::<String>(),
        )
        .unwrap();
    }
    fn record(level: &str, session: &str, operation: &str, timestamp: u64) -> Value {
        json!({"level":level,"sessionId":session,"module":"library","operationId":operation,"timestamp":timestamp})
    }

    #[test]
    fn saves_the_excerpt_without_overwriting_application_data_or_logs() {
        let directory = tempfile::tempdir().unwrap();
        let logs = directory.path().join("logs");
        let data = directory.path().join("data");
        std::fs::create_dir_all(&logs).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        write(&logs, "newbee.log", &[record("WARN", "new", "scan", 1)]);
        let destination = directory.path().join("excerpt.jsonl");
        std::fs::write(&destination, "old export").unwrap();
        let excerpt = save(&logs, &data, &destination, &Options::default()).unwrap();
        assert_eq!(
            std::fs::read_to_string(&destination).unwrap(),
            excerpt.content
        );
        assert_eq!(excerpt.records, 1);
        assert!(save(&logs, &data, &logs.join("newbee.log"), &Options::default()).is_err());
        assert!(save(
            &logs,
            &data,
            &data.join("settings.json"),
            &Options::default()
        )
        .is_err());
        assert!(!data.join("settings.json").exists());
        assert!(collect(&logs, &Options::default()).unwrap().records == 1);
    }

    #[test]
    fn defaults_to_latest_session_warnings_and_can_attach_operation_context() {
        let directory = tempfile::tempdir().unwrap();
        write(
            directory.path(),
            "newbee_old.log",
            &[record("ERROR", "old", "x", 1)],
        );
        write(
            directory.path(),
            "newbee.log",
            &[
                record("INFO", "new", "scan", 2),
                record("INFO", "new", "other", 3),
                record("WARN", "new", "scan", 4),
            ],
        );
        let excerpt = collect(directory.path(), &Options::default()).unwrap();
        assert_eq!(excerpt.records, 1);
        let excerpt = collect(
            directory.path(),
            &Options {
                include_context: true,
                ..Options::default()
            },
        )
        .unwrap();
        assert_eq!(excerpt.records, 2);
        assert!(!excerpt.content.contains("other"));
        let excerpt = collect(
            directory.path(),
            &Options {
                all_sessions: true,
                ..Options::default()
            },
        )
        .unwrap();
        assert_eq!(excerpt.records, 2);
    }

    #[test]
    fn filters_time_module_and_operation_and_redacts_paths_and_credentials() {
        let directory = tempfile::tempdir().unwrap();
        let mut issue = record("ERROR", "new", "scan", 5);
        issue["error"] = json!("token=secret");
        issue["path"] = json!("D:/Music/song.flac");
        issue["message"] = json!("failed at D:/Music/private.flac");
        write(
            directory.path(),
            "newbee.log",
            &[issue, record("WARN", "new", "other", 6)],
        );
        let options = Options {
            module: Some("library".into()),
            operation_id: Some("scan".into()),
            since: Some(5),
            until: Some(5),
            anonymize_paths: true,
            ..Options::default()
        };
        let excerpt = collect(directory.path(), &options).unwrap();
        assert_eq!(excerpt.records, 1);
        assert!(!excerpt.content.contains("secret"));
        assert!(!excerpt.content.contains("Music"));
        assert!(collect(
            directory.path(),
            &Options {
                since: Some(6),
                until: Some(5),
                ..Options::default()
            }
        )
        .is_err());
    }

    #[test]
    fn context_never_evicts_errors_or_crosses_session_boundaries() {
        let directory = tempfile::tempdir().unwrap();
        write(
            directory.path(),
            "newbee_old.log",
            &[record("INFO", "old", "scan", 0)],
        );
        let mut values = vec![record("ERROR", "new", "scan", 1)];
        values.extend((2..1_000).map(|index| {
            let mut value = record("INFO", "new", "scan", index);
            value["message"] = json!("context".repeat(50));
            value
        }));
        write(directory.path(), "newbee.log", &values);
        let excerpt = collect(
            directory.path(),
            &Options {
                all_sessions: true,
                include_context: true,
                max_bytes: Some(4_096),
                ..Options::default()
            },
        )
        .unwrap();
        assert!(excerpt.content.len() <= 4_096);
        assert!(excerpt.content.contains("\"level\":\"ERROR\""));
        assert!(!excerpt.content.contains("\"sessionId\":\"old\""));
        assert!(excerpt.omitted > 0);
    }

    #[test]
    fn bounds_large_input_output_and_reports_every_omission() {
        let directory = tempfile::tempdir().unwrap();
        let records: Vec<_> = (0..10_000)
            .map(|index| {
                let mut record = record("ERROR", "new", "scan", index);
                record["error"] = json!("x".repeat(300));
                record
            })
            .collect();
        write(directory.path(), "newbee.log", &records);
        let excerpt = collect(
            directory.path(),
            &Options {
                max_bytes: Some(4_096),
                ..Options::default()
            },
        )
        .unwrap();
        assert!(excerpt.content.len() <= 4_096);
        assert_eq!(excerpt.omitted + excerpt.records, 10_000);
        assert!(excerpt.content.contains("\"truncated\":true"));
        assert!(excerpt.content.contains("9999"));
    }

    #[test]
    fn reads_legacy_utc_timestamps_for_time_filters() {
        assert_eq!(
            legacy_timestamp("1970-01-01 0:00:01.123 +00:00:00"),
            Some(1_123)
        );
        assert_eq!(legacy_timestamp("2026-02-30 0:00:00.0 +00:00:00"), None);
        let value = parse("time=\"1970-01-01 0:00:01.0 +00:00:00\" level=WARN module=library sessionId=1 operationId=None error=broken").unwrap();
        assert_eq!(value["timestamp"], 1_000);
    }

    #[test]
    fn hides_windows_unc_and_arbitrary_absolute_unix_paths() {
        let mut value = json!({"message":"failed at '/opt/private/song.flac'", "path":"D:/Music/song.flac", "samples":["track:1"], "other":"\\\\server\\private\\song.flac"});
        anonymize(&mut value);
        let text = value.to_string();
        assert!(!text.contains("private"));
        assert!(!text.contains("Music"));
        assert!(!text.contains("track:1"));
    }

    #[test]
    fn tolerates_legacy_archives_oversized_malformed_and_partial_lines() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("newbee_old.log.bak"), "time=\"old\" level=WARN source=rust module=library sessionId=1 operationId=Some(\"scan\") broken\n").unwrap();
        let mut text = "x".repeat(1_000_000) + "\nnot json\n";
        text += &(record("ERROR", "2", "scan", 4).to_string() + "\n");
        text += "{partial";
        std::fs::write(directory.path().join("newbee.log"), text).unwrap();
        std::fs::write(directory.path().join("unrelated.log"), "do not read").unwrap();
        let excerpt = collect(
            directory.path(),
            &Options {
                all_sessions: true,
                ..Options::default()
            },
        )
        .unwrap();
        assert_eq!(excerpt.records, 2);
        assert!(excerpt.content.contains("\"unreadableRecords\":3"));
    }
}
