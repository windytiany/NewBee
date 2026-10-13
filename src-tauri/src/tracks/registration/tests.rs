use super::register;
use crate::{
    database::{tracks::persist_track, ArtworkUpdate, Database},
    metadata::{
        files,
        model::{MetadataChange, MetadataField},
    },
    tracks::model::{TrackDetails, TrackRegistrationResult},
};
use serde_json::{json, Value};
use std::{fs, path::Path};
use tauri::Manager;

fn fixture(root: &Path, name: &str) -> String {
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    path.to_string_lossy().into_owned()
}

fn registered(result: &TrackRegistrationResult) -> (&TrackDetails, bool) {
    match result {
        TrackRegistrationResult::Registered {
            track,
            needs_metadata,
        } => (track, *needs_metadata),
        TrackRegistrationResult::Failed { error, .. } => panic!("Unexpected failure: {error}"),
    }
}

#[test]
fn registers_a_thousand_placeholders_without_parsing_or_decoding_and_keeps_path_identity() {
    let directory = tempfile::tempdir().unwrap();
    let database = Database::open(":memory:").unwrap();
    let paths: Vec<_> = (0..1000)
        .map(|index| fixture(directory.path(), &format!("{index:04}.flac")))
        .collect();
    let results = register(&database, &paths).unwrap();
    assert_eq!(results.len(), 1000);
    assert_eq!(
        results
            .iter()
            .map(|result| registered(result).0.id)
            .collect::<std::collections::HashSet<_>>()
            .len(),
        1000
    );
    for (index, result) in results.iter().enumerate() {
        let (track, pending) = registered(result);
        assert!(pending);
        assert_eq!(track.title(), Some(format!("{index:04}").as_str()));
        assert!(track.duration_ms.is_none());
        assert_eq!(
            Path::new(track.path()),
            Path::new(&paths[index]).canonicalize().unwrap()
        );
    }
    assert!(files::access::take(directory.path()).is_empty());
    assert_eq!(database.artwork_decode_count(), 0);
    assert!(database.library_track_paths().unwrap().is_empty());
    let again = register(&database, &paths).unwrap();
    for (first, second) in results.iter().zip(&again) {
        assert_eq!(registered(first).0.id, registered(second).0.id);
    }
    assert!(files::access::take(directory.path()).is_empty());
    // Only this real fixture is asserted playable, not every registered path.
    assert!(rodio::Decoder::try_from(fs::File::open(&paths[0]).unwrap()).is_ok());
}

#[test]
fn sorts_each_recursive_directory_by_relative_path_and_deduplicates_overlaps() {
    let directory = tempfile::tempdir().unwrap();
    let paths =
        ["z.flac", "a/z.flac", "a.flac", "a/b.flac"].map(|name| fixture(directory.path(), name));
    fs::write(directory.path().join("cover.png"), b"not audio").unwrap();
    let database = Database::open(":memory:").unwrap();
    let results = register(
        &database,
        &[
            paths[0].clone(),
            directory.path().to_string_lossy().into_owned(),
            directory.path().join("a").to_string_lossy().into_owned(),
            paths[1].clone(),
        ],
    )
    .unwrap();
    let names: Vec<_> = results
        .iter()
        .map(|result| {
            let path = Path::new(registered(result).0.path());
            path.strip_prefix(directory.path().canonicalize().unwrap())
                .unwrap()
                .to_owned()
        })
        .collect();
    let mut sorted = vec![
        Path::new("a.flac").to_owned(),
        Path::new("a/b.flac").to_owned(),
        Path::new("a/z.flac").to_owned(),
    ];
    sorted.sort();
    let mut expected = vec![Path::new("z.flac").to_owned()];
    expected.extend(sorted);
    assert_eq!(names, expected);
    assert!(files::access::take(directory.path()).is_empty());
}

#[test]
fn broken_audio_and_unsupported_tags_remain_registered_while_path_failures_are_individual() {
    let directory = tempfile::tempdir().unwrap();
    let good = fixture(directory.path(), "good.flac");
    let broken = directory.path().join("broken.mp3");
    fs::write(&broken, b"not audio").unwrap();
    let aac = directory.path().join("unsupported.aac");
    fs::write(&aac, include_bytes!("../../../fixtures/silence.aac")).unwrap();
    let unsupported = directory.path().join("song.opus");
    fs::write(&unsupported, b"unsupported decoder").unwrap();
    let paths = vec![
        good,
        directory
            .path()
            .join("missing.flac")
            .to_string_lossy()
            .into_owned(),
        broken.to_string_lossy().into_owned(),
        aac.to_string_lossy().into_owned(),
        unsupported.to_string_lossy().into_owned(),
    ];
    let database = Database::open(":memory:").unwrap();
    let results = register(&database, &paths).unwrap();
    assert_eq!(results.len(), 5);
    assert!(registered(&results[0]).1);
    assert!(
        matches!(&results[1], TrackRegistrationResult::Failed { path, error } if path == &paths[1] && !error.is_empty())
    );
    assert!(registered(&results[2]).1);
    assert!(registered(&results[3]).1);
    assert!(
        matches!(&results[4], TrackRegistrationResult::Failed { path, .. } if path == &paths[4])
    );
    assert!(files::access::take(directory.path()).is_empty());
    assert!(files::read_track(&broken).is_err());
    assert!(rodio::Decoder::try_from(fs::File::open(&aac).unwrap()).is_ok());
}

#[test]
fn preserves_confirmed_snapshots_statistics_skip_lyrics_artwork_and_inbox_without_rescanning() {
    let directory = tempfile::tempdir().unwrap();
    let input = fixture(directory.path(), "original.flac");
    let path = Path::new(&input).canonicalize().unwrap();
    let database = Database::open(":memory:").unwrap();
    let mut confirmed = files::read_track(&path).unwrap().unwrap();
    confirmed.title = Some("Confirmed title".into());
    confirmed.lyrics = Some("Confirmed lyrics".into());
    confirmed.artwork = Some(crate::artwork::model::ArtworkContent {
        mime_type: "image/png".into(),
        image: include_bytes!("../../../fixtures/cover.png").to_vec(),
    });
    let id = {
        let mut connection = database.connection().unwrap();
        let transaction = connection.transaction().unwrap();
        let id = persist_track(&transaction, &confirmed, &ArtworkUpdate::Embedded).unwrap();
        transaction.commit().unwrap();
        id
    };
    database
        .register_inbox_path(&path.to_string_lossy())
        .unwrap();
    database.record_track_play(id).unwrap();
    database.set_tracks_skipped(&[id], true).unwrap();
    let playlist = database.create_playlist("Outside library").unwrap();
    database.append_playlist_tracks(playlist, vec![id]).unwrap();
    database.append_playlist_tracks(playlist, vec![id]).unwrap();
    let before = serde_json::to_value(database.get_track(id).unwrap()).unwrap();
    let editing = serde_json::to_value(database.get_editing_snapshot(id).unwrap()).unwrap();
    files::write_file(
        &path,
        &[MetadataChange {
            field: MetadataField::Title,
            value: Some("External change".into()),
            values: Vec::new(),
        }],
    )
    .unwrap();
    files::access::take(directory.path());
    let results = register(&database, std::slice::from_ref(&input)).unwrap();
    let (track, pending) = registered(&results[0]);
    assert_eq!(track.id, id);
    assert!(!pending);
    assert_eq!(serde_json::to_value(track).unwrap(), before);
    assert_eq!(
        serde_json::to_value(database.get_editing_snapshot(id).unwrap()).unwrap(),
        editing
    );
    assert!(files::access::take(directory.path()).is_empty());
    assert_eq!(
        database.inbox_paths().unwrap(),
        vec![path.to_string_lossy()]
    );
    assert_eq!(database.list_skipped_track_ids().unwrap(), vec![id]);
    assert_eq!(database.list_playlist_tracks(playlist).unwrap().len(), 2);
    let connection = database.connection().unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT play_count FROM track_play_statistics WHERE track_id = ?1",
                [id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT text FROM track_lyrics WHERE track_id = ?1",
                [id],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "Confirmed lyrics"
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM track_artwork WHERE track_id = ?1",
                [id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    drop(connection);
    assert!(database.library_track_paths().unwrap().is_empty());
    database
        .connection()
        .unwrap()
        .execute("UPDATE tracks SET in_library = 1 WHERE id = ?1", [id])
        .unwrap();
    assert!(!registered(&register(&database, &[input]).unwrap()[0]).1);
    assert_eq!(database.library_track_paths().unwrap().len(), 1);
    assert_eq!(
        database.inbox_paths().unwrap(),
        vec![path.to_string_lossy()]
    );
    assert!(files::access::take(directory.path()).is_empty());
    fs::remove_file(path).unwrap();
    // Browsing the batch API remains snapshot-only after the source disappears.
    assert_eq!(
        serde_json::to_value(database.get_tracks(&[id, id, 999]).unwrap()).unwrap(),
        json!([before])
    );
}

#[test]
fn database_failure_for_one_file_does_not_roll_back_successful_registrations() {
    let directory = tempfile::tempdir().unwrap();
    let paths =
        ["first.flac", "fail.flac", "last.flac"].map(|name| fixture(directory.path(), name));
    let database = Database::open(":memory:").unwrap();
    database
        .connection()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER fail_registration BEFORE INSERT ON tracks
         WHEN NEW.title = 'fail' BEGIN SELECT RAISE(FAIL, 'database fixture failure'); END;",
        )
        .unwrap();
    let results = register(&database, &paths).unwrap();
    let first = registered(&results[0]).0.id;
    assert!(
        matches!(&results[1], TrackRegistrationResult::Failed { error, .. } if error.contains("database fixture failure"))
    );
    let last = registered(&results[2]).0.id;
    assert_eq!(
        database
            .get_tracks(&[last, first, last])
            .unwrap()
            .iter()
            .map(|track| track.id)
            .collect::<Vec<_>>(),
        vec![last, first]
    );
}

#[test]
fn registration_and_batch_read_commands_return_typed_results_and_schedule_metadata() {
    let directory = tempfile::tempdir().unwrap();
    let path = fixture(directory.path(), "command.flac");
    let app = tauri::test::mock_builder()
        .manage(Database::open(":memory:").unwrap())
        .manage(crate::locking::write::WriteState::default())
        .manage(crate::tracks::scheduling::SchedulingState::default())
        .invoke_handler(tauri::generate_handler![
            crate::tracks::commands::register_local_tracks,
            crate::tracks::commands::get_tracks
        ])
        .build(tauri::generate_context!())
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let results: Value =
        crate::tracks::tests::invoke(&window, "register_local_tracks", json!({"paths": [path]}))
            .deserialize()
            .unwrap();
    assert_eq!(results[0]["status"], "registered");
    assert_eq!(results[0]["needsMetadata"], true);
    let id = results[0]["track"]["id"].as_i64().unwrap();
    let snapshots: Value =
        crate::tracks::tests::invoke(&window, "get_tracks", json!({"trackIds": [id, 999, id]}))
            .deserialize()
            .unwrap();
    assert_eq!(snapshots[0]["id"], id);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while app.state::<Database>().get_editing_snapshot(id).is_err() {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(app
        .state::<Database>()
        .get_track(id)
        .unwrap()
        .unwrap()
        .duration_ms
        .is_some());
    assert!(app
        .state::<Database>()
        .library_track_paths()
        .unwrap()
        .is_empty());
}

#[test]
fn large_embedded_cover_is_not_loaded_or_decoded_during_registration() {
    use lofty::{config::WriteOptions, file::TaggedFileExt, prelude::TagExt, tag::Tag};
    let directory = tempfile::tempdir().unwrap();
    let input = fixture(directory.path(), "cover.flac");
    let path = Path::new(&input);
    let mut image = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        2048,
        2048,
        image::Rgb([42, 42, 42]),
    ))
    .write_to(&mut image, image::ImageFormat::Bmp)
    .unwrap();
    assert!(image.get_ref().len() > 10 * 1024 * 1024);
    let cover = files::cover_picture(image.get_ref()).unwrap();
    let audio = lofty::read_from_path(path).unwrap();
    let mut tag = Tag::new(audio.primary_tag_type());
    tag.push_picture(cover);
    tag.save_to_path(path, WriteOptions::default()).unwrap();
    assert!(fs::metadata(path).unwrap().len() > 10 * 1024 * 1024);
    let database = Database::open(":memory:").unwrap();
    let results = register(&database, &[input]).unwrap();
    let id = registered(&results[0]).0.id;
    assert!(registered(&results[0]).1);
    assert!(files::access::take(directory.path()).is_empty());
    let app = tauri::test::mock_builder()
        .manage(database)
        .manage(crate::locking::write::WriteState::default())
        .manage(crate::tracks::scheduling::SchedulingState::default())
        .build(tauri::generate_context!())
        .unwrap();
    crate::tracks::scheduling::schedule(app.handle(), [id]);
    let database = app.state::<Database>();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while database.get_editing_snapshot(id).is_err() {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(database
        .get_track(id)
        .unwrap()
        .unwrap()
        .duration_ms
        .is_some());
    assert_eq!(database.artwork_decode_count(), 0);
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM artwork_images", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
