use super::support::Fixture;
use crate::{
    database::{write::WriteState, Database},
    import::files::import_music_files,
};
use tauri::Manager;

#[test]
fn editors_keep_scanned_capabilities_when_the_music_disk_is_offline() {
    let fixture = Fixture::new();
    let path = fixture.0.join("track.mp3");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.mp3")).unwrap();
    let app = tauri::test::mock_builder()
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![
            crate::metadata::get_editable_tracks
        ])
        .build(tauri::generate_context!())
        .unwrap();
    let imported = tauri::async_runtime::block_on(import_music_files(
        vec![path.to_string_lossy().into_owned()],
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    assert_eq!(serde_json::to_value(imported).unwrap()["added"], 1);
    let accesses = crate::metadata::files::access::take(&fixture.0);
    assert_eq!(
        accesses.iter().filter(|(_, kind)| *kind == "parse").count(),
        1
    );
    assert!(accesses
        .iter()
        .all(|(accessed, _)| accessed == &std::fs::canonicalize(&path).unwrap()));
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let read = || {
        tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "get_editable_tracks".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({"trackIds": [1]})),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
        .unwrap()
        .deserialize::<serde_json::Value>()
        .unwrap()
    };
    let online = read();
    assert!(online[0]["writableFields"].as_array().unwrap().len() > 4);
    std::fs::remove_file(&path).unwrap();
    assert_eq!(read(), online);
    assert!(crate::metadata::files::access::take(&fixture.0).is_empty());
}
#[test]
fn scan_reports_missing_audio_without_erasing_the_snapshot_or_playlist() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&std::fs::canonicalize(&fixture.0).unwrap().to_string_lossy())
        .unwrap();
    let app = tauri::test::mock_builder()
        .manage(database)
        .manage(WriteState::default())
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
    assert_eq!(serde_json::to_value(scan()).unwrap()["added"], 1);
    let playlist = app
        .state::<Database>()
        .create_playlist("Favorites")
        .unwrap();
    app.state::<Database>()
        .add_track_to_playlist(playlist, 1)
        .unwrap();
    let before = serde_json::to_value(app.state::<Database>().get_track(1).unwrap()).unwrap();
    std::fs::remove_file(&path).unwrap();
    assert_eq!(serde_json::to_value(scan()).unwrap()["failed"], 1);
    assert_eq!(
        serde_json::to_value(app.state::<Database>().get_track(1).unwrap()).unwrap(),
        before
    );
    assert_eq!(
        app.state::<Database>()
            .list_playlist_tracks(playlist)
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn saving_one_field_preserves_external_fields_and_refreshes_the_confirmed_snapshot() {
    use super::support::change;
    use crate::metadata::{
        files,
        model::{LyricsMarkAction, MetadataField},
        save::save_track,
    };
    use lofty::{file::TaggedFileExt, prelude::*};
    let fixture = Fixture::new();
    let path = fixture.wav();
    files::write_file(
        &path,
        &[
            change(MetadataField::Title, Some("old")),
            change(MetadataField::Artist, Some("cached")),
        ],
    )
    .unwrap();
    let database = Database::open(":memory:").unwrap();
    database
        .upsert_track(&files::read_track(&path).unwrap().unwrap())
        .unwrap();
    files::write_file(&path, &[change(MetadataField::Artist, Some("external"))]).unwrap();
    let saved = save_track(
        &database,
        1,
        &[change(MetadataField::Title, Some("selected"))],
        LyricsMarkAction::Keep,
        None,
    );
    assert!(saved.file_written && saved.database_updated);
    let file = lofty::read_from_path(&path).unwrap();
    assert_eq!(
        file.primary_tag().unwrap().artist().as_deref(),
        Some("external")
    );
    assert_eq!(
        file.primary_tag().unwrap().title().as_deref(),
        Some("selected")
    );
    assert_eq!(
        serde_json::to_value(database.get_track(1).unwrap()).unwrap()["artist"],
        "external"
    );
}

#[test]
fn every_scan_reparses_audio_without_sidecar_reads_and_clears_confirmed_removals() {
    use super::support::change;
    use crate::metadata::{files, model::MetadataField};
    let fixture = Fixture::new();
    let path = fixture.0.join("track.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    files::write_file_with_cover(
        &path,
        &[
            change(MetadataField::Title, Some("alpha")),
            change(MetadataField::Lyrics, Some("embedded")),
        ],
        Some(&files::cover_picture(include_bytes!("../../../fixtures/cover.png")).unwrap()),
    )
    .unwrap();
    let sidecar = path.with_extension("lrc");
    std::fs::write(&sidecar, "[00:01.00]sidecar").unwrap();
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&std::fs::canonicalize(&fixture.0).unwrap().to_string_lossy())
        .unwrap();
    let app = tauri::test::mock_builder()
        .manage(database)
        .manage(WriteState::default())
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
    assert_eq!(serde_json::to_value(scan()).unwrap()["added"], 1);
    assert_eq!(
        app.state::<Database>()
            .get_lyrics(1)
            .unwrap()
            .text
            .as_deref(),
        Some("embedded")
    );
    let previous = std::fs::metadata(&path).unwrap();
    files::write_file(&path, &[change(MetadataField::Title, Some("bravo"))]).unwrap();
    assert_eq!(std::fs::metadata(&path).unwrap().len(), previous.len());
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(previous.modified().unwrap()))
        .unwrap();
    files::access::take(&fixture.0);
    assert_eq!(serde_json::to_value(scan()).unwrap()["updated"], 1);
    assert_eq!(
        app.state::<Database>()
            .get_track(1)
            .unwrap()
            .unwrap()
            .title(),
        Some("bravo")
    );
    let accesses = files::access::take(&fixture.0);
    assert_eq!(
        accesses.iter().filter(|(_, kind)| *kind == "parse").count(),
        1
    );
    assert!(accesses
        .iter()
        .all(|(path, _)| path.extension().unwrap() == "flac"));
    use lofty::{config::WriteOptions, file::TaggedFileExt, prelude::*};
    let mut file = lofty::read_from_path(&path).unwrap();
    let tag = file.primary_tag_mut().unwrap();
    tag.remove_key(lofty::tag::ItemKey::Lyrics);
    tag.remove_key(lofty::tag::ItemKey::UnsyncLyrics);
    while !tag.pictures().is_empty() {
        tag.remove_picture(0);
    }
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    scan();
    assert!(app
        .state::<Database>()
        .get_lyrics(1)
        .unwrap()
        .text
        .is_none());
    assert!(matches!(
        app.state::<Database>().get_track_artwork(1).unwrap(),
        Some(crate::database::TrackArtwork::NoArtwork)
    ));
    assert_eq!(
        std::fs::read_to_string(&sidecar).unwrap(),
        "[00:01.00]sidecar"
    );
    let before = serde_json::to_value(app.state::<Database>().get_track(1).unwrap()).unwrap();
    std::fs::write(&path, b"corrupt audio").unwrap();
    assert_eq!(serde_json::to_value(scan()).unwrap()["failed"], 1);
    assert_eq!(
        serde_json::to_value(app.state::<Database>().get_track(1).unwrap()).unwrap(),
        before
    );
}

#[test]
fn import_caches_real_tag_capabilities_even_when_the_extension_is_misleading() {
    use lofty::{
        config::WriteOptions,
        prelude::*,
        tag::{ItemKey, Tag, TagType},
    };
    let fixture = Fixture::new();
    let path = fixture.0.join("mpeg-named-as-flac.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.mp3")).unwrap();
    let mut file = std::fs::File::options()
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();
    TagType::Id3v2
        .remove_from(&mut file, WriteOptions::default().preferred_padding(0))
        .unwrap();
    drop(file);
    let mut tag = Tag::new(TagType::Id3v1);
    tag.insert_text(ItemKey::TrackTitle, "legacy".into());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    let app = tauri::test::mock_builder()
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .build(tauri::generate_context!())
        .unwrap();
    let result = tauri::async_runtime::block_on(import_music_files(
        vec![path.to_string_lossy().into_owned()],
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    assert_eq!(serde_json::to_value(result).unwrap()["added"], 1);
    let edited = serde_json::to_value(
        tauri::async_runtime::block_on(crate::metadata::get_editable_tracks(
            vec![1],
            app.handle().clone(),
        ))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(edited[0]["track"]["title"], "legacy");
    let fields = edited[0]["writableFields"].as_array().unwrap();
    assert!(fields.contains(&serde_json::json!("title")));
    assert!(!fields.contains(&serde_json::json!("albumArtist")));
    assert!(!fields.contains(&serde_json::json!("releaseDate")));
    assert!(!fields.contains(&serde_json::json!("lyrics")));
    let snapshot = app.state::<Database>().get_editing_snapshot(1).unwrap();
    assert_eq!(snapshot.file_type, "Mpeg");
    assert_eq!(snapshot.tag_types, ["Id3v1"]);
}

#[test]
fn save_command_rechecks_permissions_and_tag_format_per_target() {
    use super::support::change;
    use crate::metadata::{
        files,
        model::{LyricsMarkAction, MetadataField},
        save_track_metadata,
    };
    use lofty::{
        config::WriteOptions,
        prelude::*,
        tag::{ItemKey, Tag, TagType},
    };
    let fixture = Fixture::new();
    let paths = ["one.mp3", "readonly.mp3", "changed.mp3"].map(|name| fixture.0.join(name));
    let app = tauri::test::mock_builder()
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .build(tauri::generate_context!())
        .unwrap();
    for path in &paths {
        std::fs::write(path, include_bytes!("../../../fixtures/silence.mp3")).unwrap();
    }
    tauri::async_runtime::block_on(import_music_files(
        paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    let permissions = std::fs::metadata(&paths[1]).unwrap().permissions();
    let mut readonly = permissions.clone();
    readonly.set_readonly(true);
    std::fs::set_permissions(&paths[1], readonly).unwrap();
    let mut file = std::fs::File::options()
        .read(true)
        .write(true)
        .open(&paths[2])
        .unwrap();
    TagType::Id3v2
        .remove_from(&mut file, WriteOptions::default().preferred_padding(0))
        .unwrap();
    drop(file);
    let mut tag = Tag::new(TagType::Id3v1);
    tag.insert_text(ItemKey::TrackTitle, "legacy".into());
    tag.save_to_path(&paths[2], WriteOptions::default())
        .unwrap();
    let saved = tauri::async_runtime::block_on(save_track_metadata(
        vec![1, 2, 3],
        vec![change(MetadataField::AlbumArtist, Some("selected"))],
        LyricsMarkAction::Keep,
        tauri::ipc::Channel::new(|_| Ok(())),
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    std::fs::set_permissions(&paths[1], permissions).unwrap();
    assert_eq!(
        saved
            .iter()
            .map(|result| (
                result.track_id,
                result.file_written,
                result.database_updated
            ))
            .collect::<Vec<_>>(),
        [(1, true, true), (2, false, false), (3, false, false)]
    );
    assert!(saved[1].error.as_deref().unwrap().contains("只读"));
    assert!(saved[2].error.as_deref().unwrap().contains("不支持"));
    let written = files::read_track(&paths[0]).unwrap().unwrap();
    assert_eq!(written.album_artist.as_deref(), Some("selected"));
    assert_eq!(
        serde_json::to_value(app.state::<Database>().get_track(1).unwrap()).unwrap()["albumArtist"],
        "selected"
    );
    for id in [2, 3] {
        assert!(
            serde_json::to_value(app.state::<Database>().get_track(id).unwrap()).unwrap()
                ["albumArtist"]
                .is_null()
        );
    }
    assert_eq!(
        app.state::<Database>()
            .get_editing_snapshot(1)
            .unwrap()
            .tag_types,
        ["Id3v2"]
    );
}

#[test]
fn release_command_and_lyrics_editor_write_only_selected_embedded_content() {
    use super::support::change;
    use crate::metadata::{
        model::{LyricsMarkAction, MetadataField},
        releases::save::save_album_tags,
        save_track_metadata,
    };
    let fixture = Fixture::new();
    let path = fixture.wav();
    let sidecar = path.with_extension("lrc");
    std::fs::write(&sidecar, "sidecar untouched").unwrap();
    let missing = fixture.0.join("missing.mp3");
    std::fs::write(&missing, include_bytes!("../../../fixtures/silence.mp3")).unwrap();
    let app = tauri::test::mock_builder()
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .build(tauri::generate_context!())
        .unwrap();
    tauri::async_runtime::block_on(import_music_files(
        vec![
            path.to_string_lossy().into_owned(),
            missing.to_string_lossy().into_owned(),
        ],
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    std::fs::remove_file(&missing).unwrap();
    let patches = serde_json::from_value(serde_json::json!([
        {"trackId": 1, "changes": [{"field": "title", "value": "release title"}], "writeCover": false},
        {"trackId": 2, "changes": [{"field": "title", "value": "missing title"}], "writeCover": false}
    ])).unwrap();
    let results = tauri::async_runtime::block_on(save_album_tags(
        patches,
        None,
        tauri::ipc::Channel::new(|_| Ok(())),
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    assert!(results[0].file_written && results[0].database_updated);
    assert!(!results[1].file_written && !results[1].database_updated && results[1].error.is_some());
    assert_eq!(
        crate::metadata::files::read_track(&path)
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("release title")
    );
    assert_eq!(
        app.state::<Database>()
            .get_track(1)
            .unwrap()
            .unwrap()
            .title(),
        Some("release title")
    );
    let results = tauri::async_runtime::block_on(save_track_metadata(
        vec![1],
        vec![change(MetadataField::Lyrics, Some("new embedded"))],
        LyricsMarkAction::Keep,
        tauri::ipc::Channel::new(|_| Ok(())),
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    assert!(results[0].file_written && results[0].database_updated);
    assert_eq!(
        crate::lyrics::local::embedded_lyrics_text(&lofty::read_from_path(&path).unwrap()),
        Some("new embedded")
    );
    assert_eq!(
        app.state::<Database>()
            .get_lyrics(1)
            .unwrap()
            .text
            .as_deref(),
        Some("new embedded")
    );
    assert_eq!(
        std::fs::read_to_string(&sidecar).unwrap(),
        "sidecar untouched"
    );
    std::fs::remove_file(&path).unwrap();
    crate::metadata::files::access::take(&fixture.0);
    let results = tauri::async_runtime::block_on(save_track_metadata(
        vec![1],
        vec![],
        LyricsMarkAction::Unmark,
        tauri::ipc::Channel::new(|_| Ok(())),
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    assert!(!results[0].file_written && results[0].database_updated);
    assert!(crate::metadata::files::access::take(&fixture.0).is_empty());
}
