use super::*;

pub(super) fn image(color: u8) -> Vec<u8> {
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(3, 2, image::Rgb([color, 0, 0])))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

pub(super) fn app(fixture: &Fixture, count: usize) -> tauri::App<tauri::test::MockRuntime> {
    let database = Database::open(":memory:").unwrap();
    for index in 1..=count {
        let path = fixture.0.join(format!("{index}.flac"));
        fs::write(&path, include_bytes!("../../../../fixtures/silence.flac")).unwrap();
        database
            .upsert_track(&files::read_track_metadata(&path).unwrap().unwrap(), None)
            .unwrap();
    }
    tauri::test::mock_builder()
        .manage(database)
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_track_artwork_collections,
            commands::get_artwork_picture,
            crate::artwork::track::linked::read_artwork_file,
            crate::artwork::track::plan::get_artwork_write_plan
        ])
        .build(tauri::generate_context!())
        .unwrap()
}

pub(super) fn draft(id: i64, colors: &[u8]) -> TrackDraft {
    TrackDraft {
        track_id: id,
        pictures: colors
            .iter()
            .enumerate()
            .map(|(index, color)| PictureDraft::Embedded {
                data: image(*color),
                picture_type: if index == 0 { 3 } else { 4 },
            })
            .collect(),
        display_index: (!colors.is_empty()).then_some(0),
    }
}

pub(super) fn save(
    app: &tauri::App<tauri::test::MockRuntime>,
    ids: Vec<i64>,
    drafts: Vec<TrackDraft>,
    changes: Vec<crate::metadata::model::MetadataChange>,
) -> Result<Vec<crate::metadata::MetadataSaveResult>, String> {
    tauri::async_runtime::block_on(save_track_metadata(
        MetadataSaveRequest {
            track_ids: ids,
            changes,
            lyrics_action: LyricsMarkAction::Keep,
            artwork_drafts: drafts,
        },
        tauri::ipc::Channel::new(|_| Ok(())),
        None,
        app.handle().clone(),
        app.state(),
    ))
}
