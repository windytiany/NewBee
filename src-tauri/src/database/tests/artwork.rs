use crate::database::Database;
use crate::library::import::tests::support::TestFiles;
use crate::locking::write::WriteState;
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

#[test]
fn scanned_directory_cover_is_available_for_tracks_albums_and_playlists_offline() {
    let fixture = TestFiles::new();
    fixture.wav("one.wav");
    fixture.wav("two.wav");
    let cover = include_bytes!("../../../fixtures/cover.png");
    fixture.write("CoVeR.PNG", cover);
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&std::fs::canonicalize(&fixture.0).unwrap().to_string_lossy())
        .unwrap();
    let app = tauri::test::mock_builder()
        .manage(database)
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![
            crate::library::import::directory::scan_music_library,
            crate::artwork::get_track_artwork,
            crate::artwork::get_album_artwork
        ])
        .build(tauri::generate_context!())
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let scan = invoke(
        &webview,
        "scan_music_library",
        serde_json::json!({"operationId":null}),
    )
    .deserialize::<serde_json::Value>()
    .unwrap();
    assert_eq!(scan["added"], 2);
    assert_eq!(artwork(&webview, 1), cover);
    assert_eq!(artwork(&webview, 2), cover);
    let playlist = app
        .state::<Database>()
        .create_playlist("Favorites")
        .unwrap();
    app.state::<Database>()
        .append_playlist_tracks(playlist, vec![1])
        .unwrap();
    for name in ["one.wav", "two.wav", "CoVeR.PNG"] {
        std::fs::remove_file(fixture.0.join(name)).unwrap();
    }
    crate::metadata::files::access::take(&fixture.0);
    assert_eq!(artwork(&webview, 1), cover);
    let thumbnail = invoke(
        &webview,
        "get_track_artwork",
        serde_json::json!({"trackId": 1, "size": 128}),
    );
    let tauri::ipc::InvokeResponseBody::Raw(thumbnail) = thumbnail else {
        panic!("Expected binary thumbnail");
    };
    let thumbnail = image::load_from_memory(&thumbnail).unwrap().to_rgb8();
    assert_eq!(thumbnail.dimensions(), (2, 2));
    assert_eq!(thumbnail.get_pixel(1, 1).0, [0, 0, 0]);
    let album = invoke(
        &webview,
        "get_album_artwork",
        serde_json::json!({"albumArtist":null,"album":null}),
    );
    assert!(matches!(album,tauri::ipc::InvokeResponseBody::Raw(bytes) if bytes == cover));
    let playlists =
        serde_json::to_value(app.state::<Database>().list_playlists().unwrap()).unwrap();
    assert_eq!(playlists[0]["coverTrackId"], 1);
    assert_eq!(
        artwork(&webview, playlists[0]["coverTrackId"].as_i64().unwrap()),
        cover
    );
    assert!(crate::metadata::files::access::take(&fixture.0).is_empty());
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
        database
            .add_music_library_directory(
                &std::fs::canonicalize(&files.0).unwrap().to_string_lossy(),
            )
            .unwrap();
        let app = tauri::test::mock_builder()
            .manage(database)
            .manage(WriteState::default())
            .invoke_handler(tauri::generate_handler![
                crate::library::import::directory::scan_music_library,
                crate::library::import::files::import_music_files,
                crate::artwork::get_track_artwork,
                crate::artwork::get_album_artwork,
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
            "scan_music_library",
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

#[test]
fn repeated_scans_share_one_content_identity_and_confirmed_removal_cleans_storage() {
    let library = ArtworkLibrary::new();
    library.files.wav("one.wav");
    library.files.wav("two.wav");
    let cover = include_bytes!("../../../fixtures/cover.png");
    let source = library.files.write("cover.png", cover);
    assert_eq!(library.scan()["added"], 2);
    let storage = library.storage();
    let rows = || {
        storage
            .query_row(
                "SELECT COUNT(*), COUNT(DISTINCT image_id), MIN(image_id) FROM track_artwork",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                    ))
                },
            )
            .unwrap()
    };
    assert_eq!(rows(), (2, 1, Some(1)));
    let source_rows: i64 = storage.query_row("SELECT COUNT(*) FROM track_artwork_sources WHERE source_kind = 'directory' AND source_path = ?1",[std::fs::canonicalize(&source).unwrap().to_string_lossy().as_ref()],|row|row.get(0)).unwrap();
    assert_eq!(source_rows, 2);
    assert_eq!(library.scan()["updated"], 2);
    assert_eq!(rows(), (2, 1, Some(1)));
    assert_eq!(
        storage
            .query_row("SELECT COUNT(*) FROM artwork_images", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    library.reopen();
    assert_eq!(artwork(&library.webview, 1), cover);
    std::fs::remove_file(source).unwrap();
    assert_eq!(library.scan()["updated"], 2);
    assert!(artwork(&library.webview, 1).is_empty());
    assert_eq!(rows(), (0, 0, None));
    let contents: i64 = storage
        .query_row("SELECT COUNT(*) FROM artwork_images", [], |row| row.get(0))
        .unwrap();
    assert_eq!(contents, 0);
    library.files.write("cover.png", cover);
    library.scan();
    assert_eq!(artwork(&library.webview, 1), cover);
    let (_, shared, identity) = rows();
    assert_eq!(shared, 1);
    assert!(
        identity.unwrap() > 1,
        "Removed image identities must never be reused"
    );
}

fn image_fixture(color: [u8; 3], format: image::ImageFormat) -> Vec<u8> {
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(4, 4, image::Rgb(color)))
        .write_to(&mut bytes, format)
        .unwrap();
    bytes.into_inner()
}

#[test]
fn directory_cover_names_follow_case_insensitive_priority_and_ignore_non_files() {
    let library = ArtworkLibrary::new();
    library.files.wav("one.wav");
    let names = ["CoVeR.JpG", "COVER.pNg", "FoLdEr.JpG", "FOLDER.PNG"];
    let colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
    let covers: Vec<_> = colors
        .into_iter()
        .enumerate()
        .map(|(index, color)| {
            image_fixture(
                color,
                if index % 2 == 0 {
                    image::ImageFormat::Jpeg
                } else {
                    image::ImageFormat::Png
                },
            )
        })
        .collect();
    for (name, cover) in names.iter().zip(&covers) {
        library.files.write(name, cover);
    }
    for (name, cover) in names.iter().zip(&covers) {
        assert_eq!(library.scan()["failed"], 0);
        assert_eq!(artwork(&library.webview, 1), *cover);
        std::fs::remove_file(library.files.0.join(name)).unwrap();
    }
    std::fs::create_dir(library.files.0.join("cover.jpg")).unwrap();
    library.files.write("folder.png", &covers[3]);
    assert_eq!(library.scan()["failed"], 0);
    assert_eq!(artwork(&library.webview, 1), covers[3]);
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

#[test]
fn each_scan_rechecks_all_sources_and_preserves_valid_display_until_removal() {
    let library = ArtworkLibrary::new();
    let path = std::path::PathBuf::from(
        library
            .files
            .write("one.flac", include_bytes!("../../../fixtures/silence.flac")),
    );
    let first = image_fixture([255, 0, 0], image::ImageFormat::Png);
    let replacement = image_fixture([0, 0, 255], image::ImageFormat::Png);
    assert_eq!(first.len(), replacement.len());
    let cover_path = library.files.write("cover.png", &first);
    library.scan();
    assert_eq!(artwork(&library.webview, 1), first);
    let before = std::fs::metadata(&cover_path).unwrap();
    std::fs::write(&cover_path, &replacement).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&cover_path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(before.modified().unwrap()))
        .unwrap();
    assert_eq!(std::fs::metadata(&cover_path).unwrap().len(), before.len());
    assert_eq!(library.scan()["failed"], 0);
    assert_eq!(artwork(&library.webview, 1), replacement);
    let embedded = include_bytes!("../../../fixtures/cover.png");
    write_embedded_cover(&path, embedded);
    // The failed directory read retains the selected snapshot; adding embedded art
    // does not steal a valid display choice.
    std::fs::write(&cover_path, b"broken fallback").unwrap();
    crate::metadata::files::access::take(&library.files.0);
    assert_eq!(library.scan()["failed"], 1);
    assert_eq!(artwork(&library.webview, 1), replacement);
    assert!(crate::metadata::files::access::take(&library.files.0)
        .iter()
        .any(|(_, kind)| *kind == "directory artwork read"));
    let sources: i64 = library
        .storage()
        .query_row("SELECT COUNT(*) FROM track_artwork_sources", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(sources, 2);
    write_embedded_cover(&path, &[]);
    std::fs::write(&cover_path, &replacement).unwrap();
    assert_eq!(library.scan()["failed"], 0);
    assert_eq!(artwork(&library.webview, 1), replacement);
    std::fs::remove_file(&cover_path).unwrap();
    library.scan();
    assert!(artwork(&library.webview, 1).is_empty());
}

#[test]
fn selected_file_import_and_full_scan_never_search_parent_or_child_cover_directories() {
    let library = ArtworkLibrary::new();
    std::fs::create_dir_all(library.files.0.join("album/child")).unwrap();
    let path = library.files.wav("album/one.wav");
    let cover = include_bytes!("../../../fixtures/cover.png");
    library.files.write("cover.png", cover);
    library.files.write("album/child/cover.png", cover);
    let import = || {
        invoke(
            &library.webview,
            "import_music_files",
            serde_json::json!({"paths":[path],"operationId":null}),
        )
        .deserialize::<serde_json::Value>()
        .unwrap()
    };
    assert_eq!(import()["added"], 1);
    assert!(artwork(&library.webview, 1).is_empty());
    library.scan();
    assert!(artwork(&library.webview, 1).is_empty());
    library.files.write("album/FOLDER.PNG", cover);
    assert_eq!(import()["updated"], 1);
    assert_eq!(artwork(&library.webview, 1), cover);
}

#[test]
fn invalid_directory_cover_reports_a_problem_and_retains_the_previous_snapshot() {
    let library = ArtworkLibrary::new();
    let audio = library.files.wav("one.wav");
    let cover = include_bytes!("../../../fixtures/cover.png");
    let path = library.files.write("cover.png", cover);
    library.scan();
    let playlist = library
        .app
        .state::<Database>()
        .create_playlist("Favorites")
        .unwrap();
    library
        .app
        .state::<Database>()
        .append_playlist_tracks(playlist, vec![1])
        .unwrap();
    // A lower-priority valid image does not hide failure of the chosen source.
    library.files.write(
        "folder.png",
        &image_fixture([255, 0, 0], image::ImageFormat::Png),
    );
    std::fs::write(&path, b"not an image").unwrap();
    assert_eq!(library.scan()["failed"], 1);
    assert_eq!(artwork(&library.webview, 1), cover);
    assert!(library
        .app
        .state::<Database>()
        .get_editing_snapshot(1)
        .unwrap()
        .issue
        .unwrap()
        .contains("Directory artwork"));
    library.reopen();
    assert_eq!(artwork(&library.webview, 1), cover);
    std::fs::write(&path, cover).unwrap();
    assert_eq!(library.scan()["failed"], 0);
    assert!(library
        .app
        .state::<Database>()
        .get_editing_snapshot(1)
        .unwrap()
        .issue
        .is_none());
    let before =
        serde_json::to_value(library.app.state::<Database>().get_track(1).unwrap()).unwrap();
    std::fs::write(&audio, b"broken audio").unwrap();
    assert_eq!(library.scan()["failed"], 1);
    assert_eq!(artwork(&library.webview, 1), cover);
    assert_eq!(
        serde_json::to_value(library.app.state::<Database>().get_track(1).unwrap()).unwrap(),
        before
    );
    std::fs::remove_file(audio).unwrap();
    assert_eq!(library.scan()["failed"], 1);
    assert_eq!(artwork(&library.webview, 1), cover);
    assert_eq!(
        library
            .app
            .state::<Database>()
            .list_playlist_tracks(playlist)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        serde_json::to_value(library.app.state::<Database>().get_track(1).unwrap()).unwrap(),
        before
    );
}

#[cfg(windows)]
#[test]
fn unreadable_directory_cover_is_not_treated_as_removal() {
    use std::os::windows::fs::OpenOptionsExt;
    let library = ArtworkLibrary::new();
    library.files.wav("one.wav");
    let cover = include_bytes!("../../../fixtures/cover.png");
    let path = library.files.write("cover.png", cover);
    library.scan();
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    assert_eq!(library.scan()["failed"], 1);
    assert_eq!(artwork(&library.webview, 1), cover);
    assert!(library
        .app
        .state::<Database>()
        .get_editing_snapshot(1)
        .unwrap()
        .issue
        .unwrap()
        .contains("Directory artwork"));
    drop(lock);
    assert_eq!(library.scan()["failed"], 0);
    std::fs::remove_file(path).unwrap();
    library.scan();
    assert!(artwork(&library.webview, 1).is_empty());
}

#[test]
fn cover_write_changes_only_target_embedded_tags_and_preserves_file_and_database_outcomes() {
    use crate::metadata::releases::{save::save_album_tags, CoverData};
    use lofty::prelude::*;
    let library = ArtworkLibrary::new();
    library
        .files
        .write("one.flac", include_bytes!("../../../fixtures/silence.flac"));
    library
        .files
        .write("two.flac", include_bytes!("../../../fixtures/silence.flac"));
    let directory = image_fixture([255, 0, 0], image::ImageFormat::Png);
    let directory_path = library.files.write("cover.png", &directory);
    library.scan();
    let target = library
        .app
        .state::<Database>()
        .get_track(1)
        .unwrap()
        .unwrap()
        .path()
        .to_owned();
    let other = library
        .app
        .state::<Database>()
        .get_track(2)
        .unwrap()
        .unwrap()
        .path()
        .to_owned();
    let embedded = include_bytes!("../../../fixtures/cover.png");
    let save = |ids: &[i64]| {
        let patches = ids
            .iter()
            .map(|id| {
                serde_json::from_value(
                    serde_json::json!({"trackId":id,"changes":[],"writeCover":true}),
                )
                .unwrap()
            })
            .collect();
        tauri::async_runtime::block_on(save_album_tags(
            patches,
            Some(CoverData {
                mime_type: "image/png".into(),
                data: embedded.to_vec(),
            }),
            tauri::ipc::Channel::new(|_| Ok(())),
            None,
            library.app.handle().clone(),
            library.app.state(),
        ))
        .unwrap()
    };
    let other_before = std::fs::read(&other).unwrap();
    let saved = save(&[1]);
    assert_eq!(saved.len(), 1);
    assert!(saved[0].file_written && saved[0].database_updated && saved[0].error.is_none());
    assert_eq!(
        lofty::read_from_path(&target)
            .unwrap()
            .primary_tag()
            .unwrap()
            .pictures()[0]
            .data(),
        embedded
    );
    assert_eq!(std::fs::read(&other).unwrap(), other_before);
    assert_eq!(std::fs::read(&directory_path).unwrap(), directory);
    assert_eq!(artwork(&library.webview, 1), embedded);
    assert_eq!(artwork(&library.webview, 2), directory);
    let sources: Vec<String> = library
        .storage()
        .prepare("SELECT source_kind FROM track_artwork_sources s JOIN track_artwork a ON a.id = s.artwork_id WHERE a.is_display = 1 ORDER BY a.track_id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(sources, ["embedded", "directory"]);
    // An unrelated tag write must not clear an existing directory association.
    let metadata = tauri::async_runtime::block_on(crate::metadata::save_track_metadata(
        crate::metadata::model::MetadataSaveRequest {
            track_ids: vec![2],
            changes: vec![crate::metadata::model::MetadataChange {
                values: Vec::new(),
                field: crate::metadata::model::MetadataField::Title,
                value: Some("new title".into()),
            }],
            lyrics_action: crate::metadata::model::LyricsMarkAction::Keep,
            artwork_drafts: Vec::new(),
            embed_artwork: false,
        },
        tauri::ipc::Channel::new(|_| Ok(())),
        None,
        library.app.handle().clone(),
        library.app.state(),
    ))
    .unwrap();
    assert!(metadata[0].file_written && metadata[0].database_updated);
    assert_eq!(
        lofty::read_from_path(&other)
            .unwrap()
            .primary_tag()
            .unwrap()
            .title()
            .as_deref(),
        Some("new title")
    );
    assert_eq!(
        serde_json::to_value(library.app.state::<Database>().get_track(2).unwrap()).unwrap()
            ["title"],
        "new title"
    );
    assert_eq!(artwork(&library.webview, 2), directory);
    library.storage().execute_batch("CREATE TRIGGER fail_second_cover BEFORE UPDATE OF title ON tracks WHEN NEW.id = 2 BEGIN SELECT RAISE(ABORT, 'test database failure'); END;").unwrap();
    let partial = save(&[1, 2]);
    assert_eq!(partial.len(), 2);
    assert!(partial[0].file_written && partial[0].database_updated && partial[0].error.is_none());
    assert!(partial[1].file_written && !partial[1].database_updated);
    assert!(partial[1]
        .error
        .as_deref()
        .unwrap()
        .contains("数据库同步失败"));
    assert_eq!(
        lofty::read_from_path(&other)
            .unwrap()
            .primary_tag()
            .unwrap()
            .pictures()[0]
            .data(),
        embedded
    );
    assert_eq!(artwork(&library.webview, 2), directory);
    assert_eq!(std::fs::read(&directory_path).unwrap(), directory);
    library
        .storage()
        .execute_batch("DROP TRIGGER fail_second_cover")
        .unwrap();
    let retry = save(&[2]);
    assert!(retry[0].file_written && retry[0].database_updated);
    assert_eq!(artwork(&library.webview, 2), embedded);
    library.scan();
    assert_eq!(artwork(&library.webview, 1), embedded);
    assert_eq!(artwork(&library.webview, 2), embedded);
    let contents: i64 = library
        .storage()
        .query_row("SELECT COUNT(*) FROM artwork_images", [], |row| row.get(0))
        .unwrap();
    assert_eq!(contents, 2);
    library.reopen();
    std::fs::remove_file(target).unwrap();
    std::fs::remove_file(other).unwrap();
    std::fs::remove_file(directory_path).unwrap();
    crate::metadata::files::access::take(&library.files.0);
    assert_eq!(artwork(&library.webview, 1), embedded);
    assert_eq!(artwork(&library.webview, 2), embedded);
    assert!(crate::metadata::files::access::take(&library.files.0).is_empty());
}

#[test]
fn thumbnail_derivation_does_not_block_metadata_reads() {
    use std::sync::mpsc;
    use std::time::Duration;

    let database = Database::open(":memory:").unwrap();
    super::support::insert_track(&database, 1, None, None, 1, Some(b"original"));
    std::thread::scope(|scope| {
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let database = &database;
        let derivation = scope.spawn(move || {
            database.track_artwork_bytes(1, Some(512), |original, size| {
                assert_eq!(original, b"original");
                assert_eq!(size, 512);
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(b"thumbnail".to_vec())
            })
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (metadata_tx, metadata_rx) = mpsc::channel();
        scope.spawn(move || {
            metadata_tx.send(database.get_track(1)).unwrap();
        });
        let metadata = metadata_rx.recv_timeout(Duration::from_secs(5));
        // Always release before asserting, so a regression fails instead of hanging.
        release_tx.send(()).unwrap();
        assert_eq!(derivation.join().unwrap().unwrap(), b"thumbnail");
        assert!(metadata
            .expect("metadata read blocked by thumbnail derivation")
            .unwrap()
            .is_some());
    });
}

#[test]
fn concurrent_track_and_album_requests_share_one_thumbnail() {
    use std::sync::mpsc;
    use std::time::Duration;

    let database = Database::open(":memory:").unwrap();
    for id in [1, 2] {
        super::support::insert_track(
            &database,
            id,
            Some("Artist"),
            Some("Album"),
            id,
            Some(b"original"),
        );
    }
    std::thread::scope(|scope| {
        let database = &database;
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first = scope.spawn(move || {
            database.track_artwork_bytes(1, Some(512), |_, _| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(b"shared thumbnail".to_vec())
            })
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (requested_tx, requested_rx) = mpsc::channel();
        let track_tx = requested_tx.clone();
        let track = scope.spawn(move || {
            track_tx.send(()).unwrap();
            database.track_artwork_bytes(2, Some(512), |_, _| panic!("shared image derived twice"))
        });
        let album = scope.spawn(move || {
            requested_tx.send(()).unwrap();
            database.album_artwork_bytes(
                Some("Artist".into()),
                Some("Album".into()),
                Some(512),
                |_, _| panic!("album derived shared image again"),
            )
        });
        let requested = (0..2).try_for_each(|_| requested_rx.recv_timeout(Duration::from_secs(5)));
        release_tx.send(()).unwrap();
        requested.unwrap();
        for request in [first, track, album] {
            assert_eq!(request.join().unwrap().unwrap(), b"shared thumbnail");
        }
    });
}

fn artwork_during_update(
    database: &Database,
    album: bool,
    update: impl FnOnce(&Database) + Send,
) -> Result<Vec<u8>, String> {
    use std::sync::mpsc;
    use std::time::Duration;

    std::thread::scope(|scope| {
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let derivation = scope.spawn(move || {
            let derive = |_, _| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(b"obsolete thumbnail".to_vec())
            };
            if album {
                database.album_artwork_bytes(
                    Some("Artist".into()),
                    Some("Album".into()),
                    Some(512),
                    derive,
                )
            } else {
                database.track_artwork_bytes(1, Some(512), derive)
            }
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (updated_tx, updated_rx) = mpsc::channel();
        let updating = scope.spawn(move || {
            update(database);
            updated_tx.send(()).unwrap();
        });
        let updated = updated_rx.recv_timeout(Duration::from_secs(5));
        release_tx.send(()).unwrap();
        updating.join().unwrap();
        updated.expect("association update blocked by thumbnail derivation");
        derivation.join().unwrap()
    })
}

#[test]
fn association_replacement_during_derivation_does_not_publish_old_thumbnail() {
    let database = Database::open(":memory:").unwrap();
    for id in [1, 2] {
        super::support::insert_track(&database, id, None, None, id, Some(b"original"));
    }
    let result = artwork_during_update(&database, false, |database| {
        database
            .update_metadata_cover_and_lyrics(
                1,
                &[],
                Some(Some(&crate::artwork::model::ArtworkContent {
                    mime_type: "image/png".into(),
                    image: b"replacement".to_vec(),
                })),
                None,
                crate::metadata::model::LyricsMarkAction::Keep,
                None,
            )
            .unwrap();
    });
    assert!(result.unwrap_err().contains("Artwork changed"));
    assert_eq!(
        database
            .track_artwork_bytes(1, Some(512), |original, _| {
                assert_eq!(original, b"replacement");
                Ok(b"new thumbnail".to_vec())
            })
            .unwrap(),
        b"new thumbnail"
    );
    // The old image still belongs to another track, but the obsolete request
    // must not have published its derived bytes even there.
    assert_eq!(
        database
            .track_artwork_bytes(2, Some(512), |original, _| {
                assert_eq!(original, b"original");
                Ok(b"other thumbnail".to_vec())
            })
            .unwrap(),
        b"other thumbnail"
    );
}

#[test]
fn association_removal_during_derivation_returns_no_artwork() {
    let database = Database::open(":memory:").unwrap();
    super::support::insert_track(&database, 1, None, None, 1, Some(b"original"));
    let result = artwork_during_update(&database, false, |database| {
        database
            .connection()
            .unwrap()
            .execute("DELETE FROM track_artwork WHERE track_id = 1", [])
            .unwrap();
    });
    assert!(result.unwrap().is_empty());
    assert!(database
        .track_artwork_bytes(1, Some(512), |_, _| panic!("removed artwork derived"))
        .unwrap()
        .is_empty());
}

#[test]
fn album_selection_change_during_derivation_does_not_return_old_thumbnail() {
    let database = Database::open(":memory:").unwrap();
    super::support::insert_track(
        &database,
        1,
        Some("Artist"),
        Some("Album"),
        1,
        Some(b"first"),
    );
    super::support::insert_track(
        &database,
        2,
        Some("Artist"),
        Some("Album"),
        2,
        Some(b"second"),
    );
    let result = artwork_during_update(&database, true, |database| {
        database
            .update_metadata_cover_and_lyrics(
                1,
                &[crate::metadata::model::MetadataChange {
                    values: Vec::new(),
                    field: crate::metadata::model::MetadataField::Album,
                    value: Some("Other album".into()),
                }],
                None,
                None,
                crate::metadata::model::LyricsMarkAction::Keep,
                None,
            )
            .unwrap();
    });
    assert!(result.unwrap_err().contains("Artwork changed"));
    assert_eq!(
        database
            .album_artwork_bytes(
                Some("Artist".into()),
                Some("Album".into()),
                Some(512),
                |original, _| {
                    assert_eq!(original, b"second");
                    Ok(b"current album thumbnail".to_vec())
                }
            )
            .unwrap(),
        b"current album thumbnail"
    );
}

#[test]
fn cold_thumbnail_derivation_does_not_block_cached_thumbnails_or_originals() {
    use std::sync::mpsc;
    use std::time::Duration;

    let database = Database::open(":memory:").unwrap();
    super::support::insert_track(&database, 1, None, None, 1, Some(b"original"));
    database
        .track_artwork_bytes(1, Some(128), |_, _| Ok(b"cached thumbnail".to_vec()))
        .unwrap();
    std::thread::scope(|scope| {
        let database = &database;
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let cold = scope.spawn(move || {
            database.track_artwork_bytes(1, Some(512), |_, _| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(b"cold thumbnail".to_vec())
            })
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (warm_tx, warm_rx) = mpsc::channel();
        scope.spawn(move || {
            let original = database.track_artwork_bytes(1, None, |_, _| panic!("original derived"));
            let cached = database
                .track_artwork_bytes(1, Some(128), |_, _| panic!("cached thumbnail derived"));
            warm_tx.send((original, cached)).unwrap();
        });
        let warm = warm_rx.recv_timeout(Duration::from_secs(5));
        release_tx.send(()).unwrap();
        assert_eq!(cold.join().unwrap().unwrap(), b"cold thumbnail");
        let (original, cached) = warm.expect("warm/original request blocked by cold derivation");
        assert_eq!(original.unwrap(), b"original");
        assert_eq!(cached.unwrap(), b"cached thumbnail");
    });
}
