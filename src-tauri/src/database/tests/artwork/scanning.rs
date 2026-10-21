use super::*;

#[test]
fn scanned_directory_cover_survives_missing_external_and_audio_files() {
    let fixture = TestFiles::new();
    fixture.wav("one.wav");
    fixture.wav("two.wav");
    let cover = include_bytes!("../../../../fixtures/cover.png");
    fixture.write("CoVeR.PNG", cover);
    let database = Database::open(":memory:").unwrap();
    let app = tauri::test::mock_builder()
        .manage(crate::library::synchronization::tests::support::settings(
            &fixture.0,
        ))
        .manage(crate::library::synchronization::SynchronizationState::default())
        .manage(database)
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![
            crate::library::synchronization::commands::synchronize_library,
            crate::artwork::track::commands::get_track_artwork,
            crate::artwork::track::commands::get_album_artwork
        ])
        .build(tauri::generate_context!())
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let scan = invoke(
        &webview,
        "synchronize_library",
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
    for name in ["one.wav", "two.wav"] {
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
    let source = fixture.0.join("CoVeR.PNG");
    assert_eq!(std::fs::read(&source).unwrap(), cover);
    std::fs::remove_file(&source).unwrap();
    assert_eq!(artwork(&webview, 1), cover);
    assert_eq!(artwork(&webview, 2), cover);
    assert!(
        matches!(invoke(&webview, "get_album_artwork", serde_json::json!({"albumArtist":null,"album":null})), tauri::ipc::InvokeResponseBody::Raw(bytes) if bytes == cover)
    );
    let collection = app.state::<Database>().get_artwork_collection(1).unwrap();
    assert_eq!(collection.images.len(), 1);
    assert!(collection.images[0].path.ends_with("cover.png"));
    assert!(collection.images[0].error.is_none());
    std::fs::write(source, cover).unwrap();
    assert_eq!(artwork(&webview, 1), cover);
}

#[test]
fn repeated_scans_share_content_and_missing_paths_retain_associations() {
    let library = ArtworkLibrary::new();
    library.files.wav("one.wav");
    library.files.wav("two.wav");
    let cover = include_bytes!("../../../../fixtures/cover.png");
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
    let source_rows: i64 = storage.query_row("SELECT COUNT(*) FROM track_artwork_sources WHERE source_kind = 'directory' AND source_path = ?1",[crate::artwork::track::linked::normalize(&source).unwrap()],|row|row.get(0)).unwrap();
    assert_eq!(source_rows, 2);
    assert_eq!(library.scan()["updated"], 0);
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
    assert_eq!(std::fs::read(&source).unwrap(), cover);
    std::fs::remove_file(&source).unwrap();
    assert_eq!(library.scan()["updated"], 2);
    assert!(artwork(&library.webview, 1).is_empty());
    assert_eq!(rows(), (0, 0, None));
    assert!(library
        .app
        .state::<Database>()
        .get_artwork_collection(1)
        .unwrap()
        .images
        .is_empty());
    assert_eq!(
        storage
            .query_row("SELECT COUNT(*) FROM artwork_images", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    library.files.write("cover.png", cover);
    library.scan();
    assert_eq!(artwork(&library.webview, 1), cover);
    let (_, shared, identity) = rows();
    assert_eq!(shared, 1);
    assert!(identity.is_some());
    assert_eq!(rows().0, 2);
    assert_eq!(std::fs::read(source).unwrap(), cover);
}

#[test]
fn directory_cover_names_follow_case_insensitive_priority_and_ignore_non_files() {
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
    for (index, cover) in covers.iter().enumerate() {
        let library = ArtworkLibrary::new();
        library.files.wav("one.wav");
        for (name, bytes) in names[index..].iter().zip(&covers[index..]) {
            library.files.write(name, bytes);
        }
        assert_eq!(library.scan()["failed"], 0);
        assert_eq!(artwork(&library.webview, 1), *cover);
        assert_eq!(
            std::fs::read(library.files.0.join(names[index])).unwrap(),
            *cover
        );
    }
    let library = ArtworkLibrary::new();
    library.files.wav("one.wav");
    std::fs::create_dir(library.files.0.join("cover.jpg")).unwrap();
    library.files.write("folder.png", &covers[3]);
    assert_eq!(library.scan()["failed"], 0);
    assert_eq!(artwork(&library.webview, 1), covers[3]);
}

#[test]
fn each_scan_rechecks_sources_and_retains_unavailable_display_path() {
    let library = ArtworkLibrary::new();
    let path = std::path::PathBuf::from(library.files.write(
        "one.flac",
        include_bytes!("../../../../fixtures/silence.flac"),
    ));
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
    let embedded = include_bytes!("../../../../fixtures/cover.png");
    write_embedded_cover(&path, embedded);
    // A failed directory read leaves the previous complete snapshot untouched.
    // Adding embedded art does not silently change the display choice.
    std::fs::write(&cover_path, b"broken fallback").unwrap();
    crate::metadata::files::access::take(&library.files.0);
    assert_eq!(library.scan()["failed"], 1);
    assert_eq!(artwork(&library.webview, 1), replacement);
    let collection = library
        .app
        .state::<Database>()
        .get_artwork_collection(1)
        .unwrap();
    assert_eq!(collection.images.len(), 1);
    let selected = &collection.images[collection.display_index.unwrap()];
    assert!(selected.path.ends_with("cover.png"));
    assert!(selected.error.is_none());
    assert_eq!(std::fs::read(&cover_path).unwrap(), b"broken fallback");
    assert!(crate::metadata::files::access::take(&library.files.0)
        .iter()
        .any(|(_, kind)| *kind == "directory artwork read"));
    let sources: i64 = library
        .storage()
        .query_row("SELECT COUNT(*) FROM track_artwork_sources", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(sources, 1);
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
    let cover = include_bytes!("../../../../fixtures/cover.png");
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
