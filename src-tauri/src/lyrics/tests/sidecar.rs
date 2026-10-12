use crate::database::Database;
use crate::locking::write::WriteState;
use tauri::Manager;

#[test]
fn playback_reads_only_same_name_lrc_without_changing_embedded_snapshot() {
    let directory = std::env::temp_dir().join(format!(
        "newbee-sidecar-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let directory = std::fs::canonicalize(directory).unwrap();
    let audio = directory.join("track.mp3");
    std::fs::write(&audio, include_bytes!("../../../fixtures/silence.mp3")).unwrap();
    use lofty::{
        config::WriteOptions,
        prelude::*,
        tag::{ItemKey, Tag, TagType},
    };
    let mut tag = Tag::new(TagType::Id3v2);
    tag.insert_text(ItemKey::UnsyncLyrics, "embedded original".into());
    tag.save_to_path(&audio, WriteOptions::default()).unwrap();
    let sidecar = directory.join("track.lrc");
    std::fs::write(&sidecar, "[00:01.00]sidecar words").unwrap();
    let app = tauri::test::mock_builder()
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![
            super::sidecar::get_playback_sidecar_lyrics,
            crate::lyrics::embedded::get_track_lyrics,
            crate::metadata::get_editable_tracks
        ])
        .build(tauri::generate_context!())
        .unwrap();
    tauri::async_runtime::block_on(crate::library::import::files::import_music_files(
        vec![audio.to_string_lossy().into_owned()],
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let read = |command: &str| {
        tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(if command == "get_editable_tracks" {
                    serde_json::json!({"trackIds": [1]})
                } else {
                    serde_json::json!({"trackId": 1})
                }),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
        .unwrap()
        .deserialize::<serde_json::Value>()
        .unwrap()
    };
    assert!(super::sidecar::accesses::take(&directory).is_empty());
    assert_eq!(
        read("get_playback_sidecar_lyrics"),
        serde_json::json!({"kind":"synced", "lines":[{"startMs":1000,"text":"sidecar words"}]})
    );
    assert_eq!(
        super::sidecar::accesses::take(&directory),
        vec![sidecar.clone()]
    );
    assert_eq!(
        read("get_track_lyrics"),
        serde_json::json!({"kind":"plain", "text":"embedded original"})
    );
    assert_eq!(
        std::fs::read_to_string(&sidecar).unwrap(),
        "[00:01.00]sidecar words"
    );
    assert_eq!(
        read("get_editable_tracks")[0]["lyrics"],
        "embedded original"
    );
    assert!(super::sidecar::accesses::take(&directory).is_empty());
    // Invalid, empty, metadata-only, and unreadable files all allow DB fallback.
    for content in ["", "[ar:artist]", "[00:99]broken", "[00:01.00]   "] {
        std::fs::write(&sidecar, content).unwrap();
        assert_eq!(read("get_playback_sidecar_lyrics"), serde_json::Value::Null);
        assert_eq!(
            read("get_track_lyrics"),
            serde_json::json!({"kind":"plain", "text":"embedded original"})
        );
    }
    std::fs::write(&sidecar, "plain sidecar words").unwrap();
    assert_eq!(
        read("get_playback_sidecar_lyrics"),
        serde_json::json!({"kind":"plain", "text":"plain sidecar words"})
    );
    std::fs::write(&sidecar, [0xff, 0xfe]).unwrap();
    assert_eq!(read("get_playback_sidecar_lyrics"), serde_json::Value::Null);
    std::fs::remove_file(&sidecar).unwrap();
    assert_eq!(read("get_playback_sidecar_lyrics"), serde_json::Value::Null);
    std::fs::create_dir(&sidecar).unwrap();
    assert_eq!(read("get_playback_sidecar_lyrics"), serde_json::Value::Null);
    std::fs::remove_dir(&sidecar).unwrap();
    std::fs::write(directory.join("other.lrc"), "[00:01]unrelated").unwrap();
    std::fs::write(directory.join("track.txt"), "[00:01]unrelated").unwrap();
    assert_eq!(read("get_playback_sidecar_lyrics"), serde_json::Value::Null);
    std::fs::write(&sidecar, "[00:01]unchanged sidecar").unwrap();
    let results = tauri::async_runtime::block_on(crate::metadata::save_track_metadata(
        crate::metadata::model::MetadataSaveRequest {
            track_ids: vec![1],
            changes: vec![crate::metadata::model::MetadataChange {
                values: Vec::new(),
                field: crate::metadata::model::MetadataField::Lyrics,
                value: Some("saved embedded".into()),
            }],
            lyrics_action: crate::metadata::model::LyricsMarkAction::Keep,
            cover: None,
        },
        tauri::ipc::Channel::new(|_| Ok(())),
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    assert!(results[0].file_written && results[0].database_updated);
    let tagged = lofty::read_from_path(&audio).unwrap();
    assert_eq!(
        crate::metadata::files::lyrics::embedded_lyrics_text(&tagged),
        Some("saved embedded")
    );
    assert_eq!(
        read("get_track_lyrics"),
        serde_json::json!({"kind":"plain", "text":"saved embedded"})
    );
    assert_eq!(
        std::fs::read_to_string(&sidecar).unwrap(),
        "[00:01]unchanged sidecar"
    );
    tauri::async_runtime::block_on(crate::metadata::save_track_metadata(
        crate::metadata::model::MetadataSaveRequest {
            track_ids: vec![1],
            changes: vec![],
            lyrics_action: crate::metadata::model::LyricsMarkAction::Mark,
            cover: None,
        },
        tauri::ipc::Channel::new(|_| Ok(())),
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    assert_eq!(
        read("get_track_lyrics"),
        serde_json::json!({"kind":"instrumental"})
    );
    assert_eq!(
        read("get_playback_sidecar_lyrics")["lines"][0]["text"],
        "unchanged sidecar"
    );
    std::fs::remove_dir_all(directory).unwrap();
}
