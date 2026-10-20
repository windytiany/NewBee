use super::*;

#[test]
fn cover_write_changes_only_target_embedded_tags_and_preserves_file_and_database_outcomes() {
    use crate::metadata::releases::{save::save_album_tags, CoverData};
    use lofty::prelude::*;
    let library = ArtworkLibrary::new();
    library.files.write(
        "one.flac",
        include_bytes!("../../../../fixtures/silence.flac"),
    );
    library.files.write(
        "two.flac",
        include_bytes!("../../../../fixtures/silence.flac"),
    );
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
    let embedded = include_bytes!("../../../../fixtures/cover.png");
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
