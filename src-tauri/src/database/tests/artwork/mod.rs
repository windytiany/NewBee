use super::support;
use crate::database::Database;
use crate::fixtures::TestFiles;
use crate::locking::WriteState;
use tauri::Manager;

fn invoke(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    args: serde_json::Value,
) -> tauri::ipc::InvokeResponseBody {
    tauri::test::get_ipc_response(
        webview,
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

fn artwork(webview: &tauri::WebviewWindow<tauri::test::MockRuntime>, id: i64) -> Vec<u8> {
    match invoke(
        webview,
        "get_track_artwork",
        serde_json::json!({"trackId":id,"size":null}),
    ) {
        tauri::ipc::InvokeResponseBody::Raw(bytes) => bytes,
        _ => panic!("Expected binary artwork"),
    }
}

struct ArtworkLibrary {
    files: TestFiles,
    app: tauri::App<tauri::test::MockRuntime>,
    webview: tauri::WebviewWindow<tauri::test::MockRuntime>,
}

impl ArtworkLibrary {
    fn new() -> Self {
        let files = TestFiles::new();
        let database = Database::open(files.0.join("library.sqlite")).unwrap();
        let app = tauri::test::mock_builder()
            .manage(crate::library::synchronization::tests::support::settings(
                &files.0,
            ))
            .manage(crate::library::synchronization::SynchronizationState::default())
            .manage(database)
            .manage(WriteState::default())
            .invoke_handler(tauri::generate_handler![
                crate::library::synchronization::commands::synchronize_library,
                crate::library::import::files::import_music_files,
                crate::artwork::track::commands::get_track_artwork,
                crate::artwork::track::commands::get_album_artwork,
            ])
            .build(tauri::generate_context!())
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        Self {
            files,
            app,
            webview,
        }
    }
    fn scan(&self) -> serde_json::Value {
        invoke(
            &self.webview,
            "synchronize_library",
            serde_json::json!({"operationId":null}),
        )
        .deserialize()
        .unwrap()
    }
    fn storage(&self) -> rusqlite::Connection {
        rusqlite::Connection::open(self.files.0.join("library.sqlite")).unwrap()
    }
    fn reopen(&self) {
        let reopened = Database::open(self.files.0.join("library.sqlite")).unwrap();
        std::mem::swap(
            &mut *self.app.state::<Database>().connection().unwrap(),
            &mut *reopened.connection().unwrap(),
        );
    }
}
impl Drop for ArtworkLibrary {
    fn drop(&mut self) {
        // Tauri's mock window retains its managed state. Close only this test connection.
        *self.app.state::<Database>().connection().unwrap() =
            rusqlite::Connection::open_in_memory().unwrap();
    }
}

fn image_fixture(color: [u8; 3], format: image::ImageFormat) -> Vec<u8> {
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(4, 4, image::Rgb(color)))
        .write_to(&mut bytes, format)
        .unwrap();
    bytes.into_inner()
}

fn write_embedded_cover(path: &std::path::Path, bytes: &[u8]) {
    use lofty::{config::WriteOptions, prelude::*};
    let mut audio = lofty::read_from_path(path).unwrap();
    let kind = audio.primary_tag_type();
    if audio.primary_tag().is_none() {
        audio.insert_tag(lofty::tag::Tag::new(kind));
    }
    let tag = audio.primary_tag_mut().unwrap();
    while !tag.pictures().is_empty() {
        tag.remove_picture(0);
    }
    if !bytes.is_empty() {
        tag.push_picture(crate::metadata::files::cover_picture(bytes).unwrap());
    }
    tag.save_to_path(path, WriteOptions::default()).unwrap();
}

mod failures;
mod scanning;
mod thumbnails;
mod writing;
