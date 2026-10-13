use super::*;
use crate::database::tracks::confirmation::Confirmation;
use crate::tracks::model::TrackRegistrationResult;

fn placeholder(database: &Database, path: &Path) -> i64 {
    match super::super::registration::register(database, &[path.to_string_lossy().into_owned()])
        .unwrap()
        .remove(0)
    {
        TrackRegistrationResult::Registered { track, .. } => track.id,
        _ => panic!("registration failed"),
    }
}

#[test]
fn lazy_cover_is_extracted_once_across_concurrent_requests_then_survives_missing_source() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("track.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let cover = files::cover_picture(include_bytes!("../../../fixtures/cover.png")).unwrap();
    files::write_file_with_cover(&path, &[], Some(files::CoverAction::Replace(&cover))).unwrap();
    let database = Database::open(":memory:").unwrap();
    let id = placeholder(&database, &path);
    let snapshot =
        files::read_track_metadata(Path::new(&database.get_track(id).unwrap().unwrap().path))
            .unwrap()
            .unwrap();
    database
        .confirm_tracks(vec![Confirmation {
            revision: 0,
            id,
            path: snapshot.path.clone(),
            snapshot: Ok(snapshot),
        }])
        .unwrap();
    files::access::take(directory.path());
    let write = WriteState::default();
    std::thread::scope(|scope| {
        for _ in 0..8 {
            scope.spawn(|| database.complete_track_artwork(id, &write).unwrap());
        }
    });
    let reads = files::access::take(directory.path());
    assert_eq!(
        reads
            .iter()
            .filter(|(_, operation)| *operation == "parse")
            .count(),
        1
    );
    std::fs::remove_file(&path).unwrap();
    database.complete_track_artwork(id, &write).unwrap();
    assert!(files::access::take(directory.path()).is_empty());
    let original = database
        .track_artwork_bytes(id, None, |_, _| panic!("original must not decode"))
        .unwrap();
    assert_eq!(original, cover.data());
    let first = database
        .track_artwork_bytes(id, Some(128), |bytes, size| {
            crate::artwork::encoding::thumbnail(&bytes, size)
        })
        .unwrap();
    let second = database
        .track_artwork_bytes(id, Some(128), |_, _| panic!("thumbnail must be cached"))
        .unwrap();
    assert_eq!(first, second);
    assert!(!first.is_empty());
}

#[test]
fn absent_cover_is_confirmed_once_and_directory_fallback_matches_import() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("track.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let database = Database::open(":memory:").unwrap();
    let id = placeholder(&database, &path);
    let write = WriteState::default();
    database.complete_track_artwork(id, &write).unwrap();
    files::access::take(directory.path());
    // Registering an identity whose tags are still pending must not rearm its
    // already confirmed no-artwork cache.
    assert_eq!(placeholder(&database, &path), id);
    std::fs::write(
        directory.path().join("cover.png"),
        include_bytes!("../../../fixtures/cover.png"),
    )
    .unwrap();
    database.complete_track_artwork(id, &write).unwrap();
    assert!(files::access::take(directory.path()).is_empty());
    assert!(database
        .track_artwork_bytes(id, None, |_, _| unreachable!())
        .unwrap()
        .is_empty());
    super::super::reading::reread(&database, id).unwrap();
    assert_eq!(
        database
            .track_artwork_bytes(id, None, |_, _| unreachable!())
            .unwrap(),
        include_bytes!("../../../fixtures/cover.png")
    );
    std::fs::remove_file(directory.path().join("cover.png")).unwrap();
    super::super::reading::reread(&database, id).unwrap();
    assert!(database
        .track_artwork_bytes(id, None, |_, _| unreachable!())
        .unwrap()
        .is_empty());
    std::fs::write(
        directory.path().join("cover.png"),
        include_bytes!("../../../fixtures/cover.png"),
    )
    .unwrap();
    let other = directory.path().join("other.flac");
    std::fs::write(&other, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let other_id = placeholder(&database, &other);
    database.complete_track_artwork(other_id, &write).unwrap();
    assert_eq!(
        database
            .track_artwork_bytes(other_id, None, |_, _| unreachable!())
            .unwrap(),
        include_bytes!("../../../fixtures/cover.png")
    );
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row(
                "SELECT source_kind FROM track_artwork_sources s JOIN track_artwork a ON a.id = s.artwork_id WHERE a.track_id = ?1",
                [other_id],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "directory"
    );
}

#[test]
fn lazy_snapshot_never_removes_original_cover_on_edit_and_stale_extraction_cannot_replace_an_edit()
{
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("track.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let cover = files::cover_picture(include_bytes!("../../../fixtures/cover.png")).unwrap();
    files::write_file_with_cover(&path, &[], Some(files::CoverAction::Replace(&cover))).unwrap();
    let database = Database::open(":memory:").unwrap();
    let id = placeholder(&database, &path);
    let snapshot =
        files::read_track_metadata(Path::new(&database.get_track(id).unwrap().unwrap().path))
            .unwrap()
            .unwrap();
    database
        .confirm_tracks(vec![Confirmation {
            revision: 0,
            id,
            path: snapshot.path.clone(),
            snapshot: Ok(snapshot),
        }])
        .unwrap();
    assert!(database.get_editing_snapshot(id).unwrap().issue.is_none());
    let result = save_track(
        &database,
        id,
        &[change(MetadataField::Title, "Edited")],
        LyricsMarkAction::Keep,
        None,
    );
    assert!(result.file_written && result.database_updated);
    assert_eq!(
        files::read_track(&path)
            .unwrap()
            .unwrap()
            .artwork
            .unwrap()
            .image,
        cover.data()
    );
    database
        .complete_track_artwork(id, &WriteState::default())
        .unwrap();
    database
        .confirm_track_artwork(
            id,
            &database.get_track(id).unwrap().unwrap().path,
            &crate::artwork::collection::Scan {
                embedded: Ok(Vec::new()),
                directory: Ok(Vec::new()),
            },
        )
        .unwrap();
    assert_eq!(
        database
            .track_artwork_bytes(id, None, |_, _| unreachable!())
            .unwrap(),
        cover.data()
    );
    std::fs::remove_file(path).unwrap();
    database
        .complete_track_artwork(id, &WriteState::default())
        .unwrap();
}

#[test]
fn failed_initial_cover_lookup_is_terminal_until_an_explicit_reread() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("track.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let database = Database::open(":memory:").unwrap();
    let id = placeholder(&database, &path);
    std::fs::remove_file(&path).unwrap();
    let write = WriteState::default();
    assert!(database.complete_track_artwork(id, &write).is_err());
    files::access::take(directory.path());
    database.complete_track_artwork(id, &write).unwrap();
    assert!(files::access::take(directory.path()).is_empty());
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let cover = files::cover_picture(include_bytes!("../../../fixtures/cover.png")).unwrap();
    files::write_file_with_cover(&path, &[], Some(files::CoverAction::Replace(&cover))).unwrap();
    super::super::reading::reread(&database, id).unwrap();
    assert_eq!(
        database
            .track_artwork_bytes(id, None, |_, _| unreachable!())
            .unwrap(),
        cover.data()
    );
}
