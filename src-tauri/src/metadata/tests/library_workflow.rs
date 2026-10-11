use super::support::{change, Fixture};
use crate::{
    database::{commands, write::WriteState, Database},
    metadata::{files, model::MetadataField},
};
use serde_json::{json, Value};
use tauri::Manager;

fn invoke(
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

fn json_command(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    args: Value,
) -> Value {
    invoke(window, command, args).deserialize().unwrap()
}

#[test]
fn offline_library_commands_browse_and_organize_without_inspecting_original_files() {
    let fixture = Fixture::new();
    let path = fixture.0.join("song.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    files::write_file_with_cover(
        &path,
        &[
            change(MetadataField::Title, Some("Song")),
            change(MetadataField::AlbumArtist, Some("Artist")),
            change(MetadataField::Album, Some("Album")),
            change(MetadataField::Lyrics, Some("embedded lyrics")),
        ],
        Some(files::CoverAction::Replace(
            &files::cover_picture(include_bytes!("../../../fixtures/cover.png")).unwrap(),
        )),
    )
    .unwrap();
    let original_root = std::fs::canonicalize(&fixture.0).unwrap();
    let app = tauri::test::mock_builder()
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .manage(crate::settings::SettingsState::load(fixture.0.join("settings.json")).unwrap())
        .invoke_handler(tauri::generate_handler![
            crate::playback::session::runtime::playback_session_command,
            crate::playback::session::runtime::playback_session_progress,
            commands::list_album_artists,
            commands::list_albums,
            commands::list_album_tracks,
            commands::get_track,
            commands::create_playlist,
            commands::rename_playlist,
            commands::delete_playlist,
            commands::add_track_to_playlist,
            commands::list_playlists,
            commands::list_playlist_tracks,
            commands::reorder_playlist_items,
            commands::remove_playlist_items,
            commands::set_tracks_skipped,
            commands::list_skipped_track_ids,
            commands::migrate_library_paths,
            commands::remove_track_from_library,
            crate::metadata::get_editable_tracks,
            crate::lyrics::local::get_track_lyrics,
            crate::artwork::get_track_artwork,
            crate::artwork::get_album_artwork,
        ])
        .build(tauri::generate_context!())
        .unwrap();
    crate::playback::session::initialize_test_session(
        app.handle(),
        fixture.0.join("playback-session.json"),
    );
    tauri::async_runtime::block_on(crate::import::files::import_music_files(
        vec![path.to_string_lossy().into_owned()],
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let call = |command: &str, args: Value| json_command(&window, command, args);
    let queries = [
        ("list_album_artists", json!({})),
        ("list_albums", json!({"albumArtist":"Artist"})),
        (
            "list_album_tracks",
            json!({"albumArtist":"Artist", "album":"Album"}),
        ),
        ("get_track", json!({"trackId":1})),
        ("get_track_lyrics", json!({"trackId":1})),
        ("get_editable_tracks", json!({"trackIds":[1]})),
    ];
    let online: Vec<_> = queries
        .iter()
        .map(|(command, args)| call(command, args.clone()))
        .collect();
    assert_eq!(online[3]["title"], "Song");
    assert_eq!(online[3]["codec"], "FLAC");
    assert_eq!(online[4], json!({"kind":"plain", "text":"embedded lyrics"}));
    let cover_args = json!({"trackId":1,"size":80});
    let cover = invoke(&window, "get_track_artwork", cover_args.clone());
    let tauri::ipc::InvokeResponseBody::Raw(cover) = cover else {
        panic!("Expected binary cover")
    };
    assert!(!cover.is_empty());
    std::fs::remove_file(&path).unwrap();
    files::access::take(&fixture.0);
    for ((command, args), expected) in queries.iter().zip(&online) {
        assert_eq!(call(command, args.clone()), *expected, "{command}");
    }
    for (command, args) in [
        ("get_track_artwork", cover_args),
        (
            "get_album_artwork",
            json!({"albumArtist":"Artist","album":"Album","size":80}),
        ),
    ] {
        let tauri::ipc::InvokeResponseBody::Raw(bytes) = invoke(&window, command, args) else {
            panic!("Expected binary cover")
        };
        assert_eq!(bytes, cover);
    }
    let playlist = call("create_playlist", json!({"name":"Offline"}));
    for _ in 0..2 {
        call(
            "add_track_to_playlist",
            json!({"playlistId":playlist,"trackId":1}),
        );
    }
    call(
        "rename_playlist",
        json!({"playlistId":playlist,"name":"Favorites"}),
    );
    assert_eq!(call("list_playlists", json!({}))[0]["name"], "Favorites");
    let entries = call("list_playlist_tracks", json!({"playlistId":playlist}));
    assert_eq!(entries.as_array().unwrap().len(), 2);
    let first = entries[0]["playlistItemId"].clone();
    let second = entries[1]["playlistItemId"].clone();
    call(
        "reorder_playlist_items",
        json!({"playlistId":playlist,"orderedPlaylistItemIds":[second,first]}),
    );
    assert_eq!(
        call("list_playlist_tracks", json!({"playlistId":playlist}))[0]["playlistItemId"],
        second
    );
    let queue_rows = json!([
        {"trackId":1,"rowKey":format!("playlist-item:{first}"),"title":"First","album":"Album","durationMs":100},
        {"trackId":1,"rowKey":format!("playlist-item:{second}"),"title":"Second","album":"Album","durationMs":100}
    ]);
    let playback = call(
        "playback_session_command",
        json!({"command":{"action":"playTracks","tracks":queue_rows,"startRowKey":format!("playlist-item:{first}"),"allowSkipped":true}}),
    );
    assert_eq!(
        playback["snapshot"]["displayedTracks"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    call(
        "remove_playlist_items",
        json!({"playlistId":playlist,"playlistItemIds":[first]}),
    );
    // Playlist mutations preserve the listening queue, including duplicate rows.
    let after_playlist_removal = call(
        "playback_session_command",
        json!({"command":{"action":"snapshot"}}),
    );
    assert_eq!(
        after_playlist_removal["snapshot"]["displayedTracks"],
        queue_rows
    );
    assert_eq!(
        after_playlist_removal["snapshot"]["currentPlaybackId"],
        playback["snapshot"]["currentPlaybackId"]
    );
    call("set_tracks_skipped", json!({"trackIds":[1],"skipped":true}));
    assert_eq!(call("list_skipped_track_ids", json!({})), json!([1]));
    let new_root = fixture
        .0
        .join("offline-destination")
        .to_string_lossy()
        .into_owned();
    assert_eq!(
        call(
            "migrate_library_paths",
            json!({"oldPath":original_root,"newPath":new_root})
        ),
        2
    );
    assert!(call("get_track", json!({"trackId":1}))["path"]
        .as_str()
        .unwrap()
        .contains("offline-destination"));
    assert_eq!(
        call("remove_track_from_library", json!({"trackId":1})),
        json!({"status":"removed"})
    );
    // The database command itself cleans all queue occurrences. No frontend
    // follow-up removeTrackFromQueue command participates in this operation.
    let after_library_removal = call(
        "playback_session_command",
        json!({"command":{"action":"snapshot"}}),
    );
    assert_eq!(
        after_library_removal["snapshot"]["displayedTracks"],
        json!([])
    );
    assert_eq!(
        after_library_removal["snapshot"]["currentTrack"],
        Value::Null
    );
    assert_eq!(call("get_track", json!({"trackId":1})), Value::Null);
    assert_eq!(
        call("list_playlist_tracks", json!({"playlistId":playlist})),
        json!([])
    );
    call("delete_playlist", json!({"playlistId":playlist}));
    assert_eq!(call("list_playlists", json!({})), json!([]));
    assert!(files::access::take(&fixture.0).is_empty());
}

#[test]
fn save_command_retains_each_file_and_database_outcome_when_database_is_locked() {
    use crate::metadata::{model::LyricsMarkAction, save_track_metadata};
    use lofty::{file::TaggedFileExt, prelude::*};
    let fixture = Fixture::new();
    let paths = [fixture.0.join("one.flac"), fixture.0.join("two.flac")];
    for path in &paths {
        std::fs::write(path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
        files::write_file(path, &[change(MetadataField::Title, Some("old"))]).unwrap();
    }
    let database_path = fixture.0.join("library.sqlite3");
    let app = tauri::test::mock_builder()
        .manage(Database::open(&database_path).unwrap())
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![commands::get_track])
        .build(tauri::generate_context!())
        .unwrap();
    tauri::async_runtime::block_on(crate::import::files::import_music_files(
        paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let blocker = rusqlite::Connection::open(&database_path).unwrap();
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
    let missing_bytes = std::fs::read(&paths[1]).unwrap();
    std::fs::remove_file(&paths[1]).unwrap();
    let save = |ids| {
        tauri::async_runtime::block_on(save_track_metadata(
            crate::metadata::model::MetadataSaveRequest {
                track_ids: ids,
                changes: vec![change(MetadataField::Title, Some("new"))],
                lyrics_action: LyricsMarkAction::Keep,
                cover: None,
            },
            tauri::ipc::Channel::new(|_| Ok(())),
            None,
            app.handle().clone(),
            app.state(),
        ))
        .unwrap()
    };
    let results = save(vec![1, 2]);
    assert_eq!(
        results
            .iter()
            .map(|entry| (entry.track_id, entry.file_written, entry.database_updated))
            .collect::<Vec<_>>(),
        [(1, true, false), (2, false, false)]
    );
    assert!(results[0]
        .error
        .as_deref()
        .unwrap()
        .contains("数据库同步失败"));
    assert!(results[1].error.is_some());
    assert_eq!(
        lofty::read_from_path(&paths[0])
            .unwrap()
            .primary_tag()
            .unwrap()
            .title()
            .as_deref(),
        Some("new")
    );
    for id in [1, 2] {
        assert_eq!(
            json_command(&window, "get_track", json!({"trackId":id}))["title"],
            "old"
        );
    }
    blocker.execute_batch("ROLLBACK").unwrap();
    std::fs::write(&paths[1], &missing_bytes).unwrap();
    let saved_bytes = std::fs::read(&paths[0]).unwrap();
    let results = save(vec![1, 2]);
    assert!(results
        .iter()
        .all(|entry| entry.file_written && entry.database_updated && entry.error.is_none()));
    assert_eq!(std::fs::read(&paths[0]).unwrap(), saved_bytes);
    for (index, path) in paths.iter().enumerate() {
        assert_eq!(
            lofty::read_from_path(path)
                .unwrap()
                .primary_tag()
                .unwrap()
                .title()
                .as_deref(),
            Some("new")
        );
        assert_eq!(
            json_command(&window, "get_track", json!({"trackId":index + 1}))["title"],
            "new"
        );
    }
    drop(blocker);
    app.state::<Database>().close_test_connection();
}

#[test]
fn scanned_shared_cover_survives_targeted_file_save_and_cold_thumbnail_reuse() {
    use crate::metadata::releases::{save::save_album_tags, CoverData};
    use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
    use lofty::file::TaggedFileExt;
    let fixture = Fixture::new();
    let paths = [fixture.0.join("one.flac"), fixture.0.join("two.flac")];
    for path in &paths {
        std::fs::write(path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    }
    let picture = |color| {
        let mut output = std::io::Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(RgbImage::from_pixel(100, 100, Rgb(color)))
            .write_to(&mut output, ImageFormat::Png)
            .unwrap();
        output.into_inner()
    };
    let red = picture([255, 0, 0]);
    let blue = picture([0, 0, 255]);
    let directory_cover = fixture.0.join("cover.png");
    std::fs::write(&directory_cover, &red).unwrap();
    let database_path = fixture.0.join("library.sqlite3");
    let database = Database::open(&database_path).unwrap();
    database
        .add_music_library_directory(&std::fs::canonicalize(&fixture.0).unwrap().to_string_lossy())
        .unwrap();
    let app = tauri::test::mock_builder()
        .manage(database)
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![crate::artwork::get_track_artwork])
        .build(tauri::generate_context!())
        .unwrap();
    let scan = || {
        tauri::async_runtime::block_on(crate::import::directory::scan_music_library(
            None,
            app.handle().clone(),
            app.state(),
        ))
        .unwrap()
    };
    assert_eq!(serde_json::to_value(scan()).unwrap()["added"], 2);
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let thumbnail = |id| {
        let tauri::ipc::InvokeResponseBody::Raw(bytes) = invoke(
            &window,
            "get_track_artwork",
            json!({"trackId":id,"size":40}),
        ) else {
            panic!("Expected binary thumbnail")
        };
        bytes
    };
    let shared = thumbnail(1);
    assert_eq!(thumbnail(2), shared);
    let saved = tauri::async_runtime::block_on(save_album_tags(
        serde_json::from_value(json!([{"trackId":1,"changes":[],"writeCover":true}])).unwrap(),
        Some(CoverData {
            mime_type: "image/png".into(),
            data: blue.clone(),
        }),
        tauri::ipc::Channel::new(|_| Ok(())),
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    assert!(saved[0].file_written && saved[0].database_updated && saved[0].error.is_none());
    // File, library response and shared directory image are independent outcomes.
    assert_eq!(
        lofty::read_from_path(&paths[0])
            .unwrap()
            .primary_tag()
            .unwrap()
            .pictures()[0]
            .data(),
        blue
    );
    assert!(lofty::read_from_path(&paths[1])
        .unwrap()
        .tags()
        .iter()
        .all(|tag| tag.pictures().is_empty()));
    assert_eq!(std::fs::read(&directory_cover).unwrap(), red);
    let updated = thumbnail(1);
    assert_eq!(
        image::load_from_memory(&updated)
            .unwrap()
            .to_rgb8()
            .get_pixel(0, 0)
            .0,
        [0, 0, 255]
    );
    assert_eq!(thumbnail(2), shared);
    assert_eq!(serde_json::to_value(scan()).unwrap()["updated"], 2);
    assert_eq!(thumbnail(1), updated);
    assert_eq!(thumbnail(2), shared);
    drop(window);
    app.state::<Database>().close_test_connection();
    drop(app);
    for path in &paths {
        std::fs::remove_file(path).unwrap();
    }
    std::fs::remove_file(&directory_cover).unwrap();
    files::access::take(&fixture.0);
    let app = tauri::test::mock_builder()
        .manage(Database::open(&database_path).unwrap())
        .invoke_handler(tauri::generate_handler![crate::artwork::get_track_artwork])
        .build(tauri::generate_context!())
        .unwrap();
    assert_eq!(app.state::<Database>().artwork_decode_count(), 0);
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    for (id, expected) in [(1, updated), (2, shared)] {
        let tauri::ipc::InvokeResponseBody::Raw(bytes) = invoke(
            &window,
            "get_track_artwork",
            json!({"trackId":id,"size":40}),
        ) else {
            panic!("Expected binary thumbnail")
        };
        assert_eq!(bytes, expected);
    }
    assert_eq!(app.state::<Database>().artwork_decode_count(), 0);
    assert!(files::access::take(&fixture.0).is_empty());
    app.state::<Database>().close_test_connection();
}
