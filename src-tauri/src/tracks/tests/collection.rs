use super::*;
use crate::artwork::collection::{Draft, DraftPicture};
use lofty::{config::WriteOptions, file::TaggedFileExt, prelude::*};

fn png(color: u8) -> Vec<u8> {
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2, 2, image::Rgb([color, 0, 0])))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

fn write_pictures(path: &Path, pictures: &[(u8, &[u8])]) {
    let mut file = lofty::read_from_path(path).unwrap();
    if file.primary_tag().is_none() {
        file.insert_tag(lofty::tag::Tag::new(file.primary_tag_type()));
    }
    let tag = file.primary_tag_mut().unwrap();
    while !tag.pictures().is_empty() {
        tag.remove_picture(0);
    }
    for (picture_type, bytes) in pictures {
        let mut picture = files::cover_picture(bytes).unwrap();
        picture.set_pic_type(lofty::picture::PictureType::from_u8(*picture_type));
        tag.push_picture(picture);
    }
    tag.save_to_path(path, WriteOptions::default()).unwrap();
}

fn placeholder(database: &Database, path: &Path) -> i64 {
    match super::super::registration::register(database, &[path.to_string_lossy().into_owned()])
        .unwrap()
        .remove(0)
    {
        crate::tracks::model::TrackRegistrationResult::Registered { track, .. } => track.id,
        _ => panic!("registration failed"),
    }
}

#[test]
fn lazy_import_and_reread_collect_all_embedded_types_and_all_directory_candidates_with_identical_selection(
) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("track.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let front = png(1);
    let back = png(2);
    let folder = png(3);
    write_pictures(&path, &[(4, &back), (3, &front)]);
    std::fs::write(directory.path().join("COVER.PNG"), &back).unwrap();
    std::fs::write(directory.path().join("folder.png"), &folder).unwrap();
    let lazy = Database::open(":memory:").unwrap();
    let id = placeholder(&lazy, &path);
    files::access::take(directory.path());
    lazy.complete_track_artwork(id, &WriteState::default())
        .unwrap();
    let reads = files::access::take(directory.path());
    assert_eq!(
        reads
            .iter()
            .filter(|(_, operation)| *operation == "parse")
            .count(),
        1
    );
    assert_eq!(
        reads
            .iter()
            .filter(|(_, operation)| *operation == "directory artwork read")
            .count(),
        2
    );
    let collection = lazy.get_artwork_collection(id).unwrap();
    assert_eq!(collection.images.len(), 3);
    assert_eq!(
        collection.images[collection.display_index.unwrap()]
            .picture
            .content
            .image,
        front
    );
    let sources: i64 = lazy
        .connection()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM track_artwork_sources", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(sources, 4);

    let imported = Database::open(":memory:").unwrap();
    let mut result = crate::library::import::ImportResult::default();
    crate::library::import::import_track(&imported, &path.canonicalize().unwrap(), &mut result);
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        json!({"added":1,"updated":0,"skipped":0,"failed":0})
    );
    let collection = imported.get_artwork_collection(1).unwrap();
    assert_eq!(collection.images.len(), 3);
    assert_eq!(
        collection.images[collection.display_index.unwrap()]
            .picture
            .content
            .image,
        front
    );

    let result = super::super::reading::reread(&lazy, id).unwrap();
    assert!(result.database_updated && result.error.is_none());
    assert_eq!(lazy.get_artwork_collection(id).unwrap().images.len(), 3);
    std::fs::remove_file(&path).unwrap();
    std::fs::remove_file(directory.path().join("COVER.PNG")).unwrap();
    std::fs::remove_file(directory.path().join("folder.png")).unwrap();
    files::access::take(directory.path());
    lazy.complete_track_artwork(id, &WriteState::default())
        .unwrap();
    assert_eq!(
        lazy.track_artwork_bytes(id, None, |_, _| panic!("original derived"))
            .unwrap(),
        front
    );
    assert!(files::access::take(directory.path()).is_empty());
}

#[test]
fn reread_partial_directory_failure_reports_committed_metadata_and_preserves_type_and_display_edits(
) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("track.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let front = png(1);
    let back = png(2);
    let folder = png(3);
    write_pictures(&path, &[(3, &front), (4, &back)]);
    let source = directory.path().join("cover.png");
    std::fs::write(&source, &folder).unwrap();
    let database = Database::open(":memory:").unwrap();
    let id = placeholder(&database, &path);
    database
        .complete_track_artwork(id, &WriteState::default())
        .unwrap();
    let mut draft = Draft::from(database.get_artwork_collection(id).unwrap());
    let DraftPicture::Existing { picture_type, .. } = &mut draft.pictures[1] else {
        panic!("existing back")
    };
    *picture_type = 18;
    draft.display_index = Some(2);
    database.save_artwork_drafts(&[(id, draft)]).unwrap();
    write_pictures(&path, &[(3, &back)]);
    files::write_file(&path, &[change(MetadataField::Title, "Reread")]).unwrap();
    std::fs::write(&source, b"corrupt image").unwrap();
    let result = super::super::reading::reread(&database, id).unwrap();
    assert!(result.database_updated);
    assert!(result.error.as_ref().unwrap().contains("Directory artwork"));
    assert_eq!(
        database.get_track(id).unwrap().unwrap().title(),
        Some("Reread")
    );
    assert!(database
        .get_editing_snapshot(id)
        .unwrap()
        .issue
        .unwrap()
        .contains("Directory artwork"));
    let collection = database.get_artwork_collection(id).unwrap();
    assert_eq!(collection.images.len(), 2);
    assert_eq!(collection.images[0].picture.picture_type, 18);
    assert_eq!(
        collection.images[collection.display_index.unwrap()]
            .picture
            .content
            .image,
        folder
    );
    std::fs::remove_file(&source).unwrap();
    let result = super::super::reading::reread(&database, id).unwrap();
    assert!(result.database_updated && result.error.is_none());
    assert!(database.get_editing_snapshot(id).unwrap().issue.is_none());
    assert_eq!(database.get_artwork_collection(id).unwrap().images.len(), 1);
}

#[test]
fn ordinary_tag_save_preserves_database_only_deletion_manual_addition_type_override_and_display_choice(
) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("track.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let front = png(1);
    let back = png(2);
    let manual = png(3);
    write_pictures(&path, &[(3, &front), (4, &back)]);
    let database = Database::open(":memory:").unwrap();
    let id = placeholder(&database, &path);
    database
        .complete_track_artwork(id, &WriteState::default())
        .unwrap();
    let mut draft = Draft::from(database.get_artwork_collection(id).unwrap());
    draft.pictures.remove(0);
    let DraftPicture::Existing { picture_type, .. } = &mut draft.pictures[0] else {
        panic!("existing back")
    };
    *picture_type = 8;
    draft
        .pictures
        .push(DraftPicture::New(crate::artwork::collection::Picture {
            content: crate::artwork::model::ArtworkContent {
                mime_type: "image/png".into(),
                image: manual.clone(),
            },
            picture_type: 18,
        }));
    draft.display_index = Some(1);
    database.save_artwork_drafts(&[(id, draft)]).unwrap();
    let before = database.get_artwork_collection(id).unwrap();
    let result = save_track(
        &database,
        id,
        &[change(MetadataField::Title, "Saved")],
        LyricsMarkAction::Keep,
        None,
    );
    assert!(result.file_written && result.database_updated && result.error.is_none());
    let file = lofty::read_from_path(&path).unwrap();
    assert_eq!(file.primary_tag().unwrap().pictures().len(), 2);
    assert_eq!(file.primary_tag().unwrap().pictures()[0].data(), front);
    assert_eq!(file.primary_tag().unwrap().pictures()[1].data(), back);
    assert_eq!(
        file.primary_tag().unwrap().title().as_deref(),
        Some("Saved")
    );
    let after = database.get_artwork_collection(id).unwrap();
    assert_eq!(after.display_index, before.display_index);
    assert_eq!(after.images.len(), 2);
    assert_eq!(after.images[0].content_id, before.images[0].content_id);
    assert_eq!(after.images[0].picture.picture_type, 8);
    assert_eq!(after.images[1].picture.content.image, manual);
    assert_eq!(
        database
            .track_artwork_bytes(id, None, |_, _| panic!("original derived"))
            .unwrap(),
        manual
    );
}

#[test]
fn deleting_directory_picture_from_database_leaves_file_and_next_scan_reimports_it() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("track.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let source = directory.path().join("cover.png");
    let cover = png(1);
    std::fs::write(&source, &cover).unwrap();
    let database = Database::open(":memory:").unwrap();
    let id = placeholder(&database, &path);
    database
        .complete_track_artwork(id, &WriteState::default())
        .unwrap();
    files::access::take(directory.path());
    database
        .save_artwork_drafts(&[(id, Draft::default())])
        .unwrap();
    assert!(files::access::take(directory.path()).is_empty());
    assert_eq!(std::fs::read(&source).unwrap(), cover);
    assert!(database
        .get_artwork_collection(id)
        .unwrap()
        .images
        .is_empty());
    super::super::reading::reread(&database, id).unwrap();
    assert_eq!(
        database
            .track_artwork_bytes(id, None, |_, _| panic!("original derived"))
            .unwrap(),
        cover
    );
}
