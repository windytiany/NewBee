use crate::{
    database::Database,
    locking::WriteState,
    metadata::{
        files,
        model::{LyricsMarkAction, MetadataChange, MetadataField},
        save::save_track,
    },
};
mod artwork;
mod collection;
mod presentation;
mod registration;

use serde_json::{json, Value};
use std::path::Path;
use tauri::Manager;

fn change(field: MetadataField, value: &str) -> MetadataChange {
    MetadataChange {
        field,
        value: Some(value.into()),
        values: Vec::new(),
    }
}

fn register(database: &Database, path: &Path) -> i64 {
    let snapshot = super::inspect(database, path).unwrap();
    crate::database::tests::support::snapshot(database, &snapshot)
}

pub(super) fn invoke(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    args: Value,
) -> tauri::ipc::InvokeResponseBody {
    tauri::test::get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .unwrap()
}

mod capabilities;
mod refresh;
