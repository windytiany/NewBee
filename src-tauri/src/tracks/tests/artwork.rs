use super::*;
use crate::database::tracks::confirmation::Confirmation;
use crate::tracks::model::TrackRegistrationResult;

fn placeholder(database: &Database, path: &Path) -> i64 {
    match super::super::register(database, &[path.to_string_lossy().into_owned()])
        .unwrap()
        .remove(0)
    {
        TrackRegistrationResult::Registered { track, .. } => track.id,
        _ => panic!("registration failed"),
    }
}

fn confirm(database: &Database, id: i64) {
    let (path, revision) = database.pending_track(id).unwrap().unwrap();
    let snapshot = crate::tracks::inspect(database, Path::new(&path));
    database
        .confirm_tracks(vec![Confirmation {
            id,
            revision,
            path,
            snapshot,
        }])
        .unwrap();
}

#[test]
fn background_confirmation_completes_artwork_and_daily_reads_survive_missing_source() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("track.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let cover = files::cover_picture(include_bytes!("../../../fixtures/cover.png")).unwrap();
    files::write_file_with_cover(&path, &[], Some(files::CoverAction::Replace(&cover))).unwrap();
    let database = Database::open(":memory:").unwrap();
    let id = placeholder(&database, &path);
    assert!(database
        .track_artwork_bytes(id, None, |_, _| unreachable!())
        .unwrap()
        .is_empty());
    files::access::take(directory.path());
    confirm(&database, id);
    assert_eq!(
        files::access::take(directory.path())
            .iter()
            .filter(|(_, kind)| *kind == "parse")
            .count(),
        1
    );
    assert!(database.pending_track(id).unwrap().is_none());
    assert_eq!(database.get_artwork_collection(id).unwrap().images.len(), 1);
    std::fs::remove_file(&path).unwrap();
    files::access::take(directory.path());
    std::thread::scope(|scope| {
        for _ in 0..8 {
            let database = &database;
            let cover = &cover;
            scope.spawn(move || {
                assert_eq!(
                    database
                        .track_artwork_bytes(id, None, |_, _| unreachable!())
                        .unwrap(),
                    cover.data()
                )
            });
        }
    });
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
    assert!(files::access::take(directory.path()).is_empty());
}

#[test]
fn absence_is_a_successful_snapshot_until_explicit_reread() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("track.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let database = Database::open(":memory:").unwrap();
    let id = placeholder(&database, &path);
    confirm(&database, id);
    assert_eq!(placeholder(&database, &path), id);
    std::fs::write(
        directory.path().join("cover.png"),
        include_bytes!("../../../fixtures/cover.png"),
    )
    .unwrap();
    files::access::take(directory.path());
    assert!(database
        .track_artwork_bytes(id, None, |_, _| unreachable!())
        .unwrap()
        .is_empty());
    assert!(files::access::take(directory.path()).is_empty());
    crate::tracks::refresh::reread(&database, id).unwrap();
    assert_eq!(
        database
            .track_artwork_bytes(id, None, |_, _| unreachable!())
            .unwrap(),
        include_bytes!("../../../fixtures/cover.png")
    );
    std::fs::remove_file(directory.path().join("cover.png")).unwrap();
    crate::tracks::refresh::reread(&database, id).unwrap();
    assert!(database
        .track_artwork_bytes(id, None, |_, _| unreachable!())
        .unwrap()
        .is_empty());
}

#[test]
fn failed_initial_inspection_is_terminal_until_explicit_reread() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("track.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let database = Database::open(":memory:").unwrap();
    let id = placeholder(&database, &path);
    std::fs::write(directory.path().join("cover.png"), b"corrupt image").unwrap();
    confirm(&database, id);
    assert!(database.pending_track(id).unwrap().is_none());
    assert!(database.get_editing_snapshot(id).unwrap().issue.is_some());
    assert!(database
        .get_artwork_collection(id)
        .unwrap()
        .images
        .is_empty());
    std::fs::write(
        directory.path().join("cover.png"),
        include_bytes!("../../../fixtures/cover.png"),
    )
    .unwrap();
    files::access::take(directory.path());
    assert!(database
        .track_artwork_bytes(id, None, |_, _| unreachable!())
        .unwrap()
        .is_empty());
    assert!(files::access::take(directory.path()).is_empty());
    crate::tracks::refresh::reread(&database, id).unwrap();
    assert!(database.get_editing_snapshot(id).unwrap().issue.is_none());
    assert_eq!(
        database
            .track_artwork_bytes(id, None, |_, _| unreachable!())
            .unwrap(),
        include_bytes!("../../../fixtures/cover.png")
    );
}
