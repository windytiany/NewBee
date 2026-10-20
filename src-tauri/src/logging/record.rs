use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) fn format(
    session: u128,
    time: &str,
    level: log::Level,
    target: &str,
    operation: Option<&str>,
    message: &str,
) -> String {
    let mut fields = serde_json::from_str::<Value>(message)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    if fields.is_empty() {
        fields.insert(
            "message".into(),
            json!(message.chars().take(8_000).collect::<String>()),
        );
        if let Some(event) = message
            .strip_prefix("event=")
            .and_then(|text| text.split_whitespace().next())
        {
            fields.insert("event".into(), json!(event));
        }
    }
    fields.insert("time".into(), json!(time));
    fields.insert(
        "timestamp".into(),
        json!(SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64),
    );
    fields.insert("level".into(), json!(level.as_str()));
    fields.insert("sessionId".into(), json!(session.to_string()));
    fields.insert(
        "source".into(),
        json!(if target.starts_with("webview") {
            "frontend"
        } else {
            "rust"
        }),
    );
    fields.entry("module").or_insert_with(|| json!(target));
    if let Some(operation) = operation {
        fields.insert("operationId".into(), json!(operation));
    }
    let mut value = Value::Object(fields);
    redact(&mut value);
    fn bound(value: &mut Value, truncated: &mut bool) {
        match value {
            Value::String(text) if text.chars().count() > 2_000 => {
                *text = text.chars().take(2_000).collect();
                *truncated = true;
            }
            Value::Array(values) => values.iter_mut().for_each(|value| bound(value, truncated)),
            Value::Object(fields) => fields
                .values_mut()
                .for_each(|value| bound(value, truncated)),
            _ => {}
        }
    }
    let mut truncated = false;
    bound(&mut value, &mut truncated);
    if truncated {
        value["textTruncated"] = json!(true);
    }
    value.to_string()
}

pub(super) fn redact(value: &mut Value) {
    match value {
        Value::String(text) => *text = super::redact_text(text),
        Value::Array(values) => values.iter_mut().for_each(redact),
        Value::Object(fields) => fields.values_mut().for_each(redact),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emits_one_json_record_with_frontend_operation_and_redaction() {
        let text = format(
            42,
            "now",
            log::Level::Warn,
            "webview",
            None,
            r#"{"module":"library","operationId":"scan:1","error":"token=secret\nnext","event":"scan_failed"}"#,
        );
        let record: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(record["operationId"], "scan:1");
        assert_eq!(record["sessionId"], "42");
        assert_eq!(record["level"], "WARN");
        assert_eq!(text.lines().count(), 1);
        assert!(!text.contains("secret"));
    }

    #[test]
    fn scopes_rust_operations_and_bounds_legacy_messages() {
        let record: Value = serde_json::from_str(&format(
            42,
            "now",
            log::Level::Error,
            "newbee_lib::library",
            Some("scan:1"),
            "event=scan_failed error=broken",
        ))
        .unwrap();
        assert_eq!(record["event"], "scan_failed");
        assert_eq!(record["operationId"], "scan:1");
        let record: Value = serde_json::from_str(&format(
            42,
            "now",
            log::Level::Info,
            "newbee_lib",
            None,
            &"x".repeat(100_000),
        ))
        .unwrap();
        assert_eq!(record["message"].as_str().unwrap().len(), 2_000);
        assert_eq!(record["textTruncated"], true);
    }
}
