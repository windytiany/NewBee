use crate::{
    database::Database,
    fixtures::TestFiles,
    metadata::revision::{read as revision, Revision},
    tasks::validate,
};

#[test]
fn revisions_detect_database_only_changes_and_remain_available_offline() {
    let files = TestFiles::new();
    let path = files.wav("track.wav");
    let database_path = files.0.join("library.sqlite3");
    let database = Database::open(&database_path).unwrap();
    let snapshot = crate::tracks::inspect(&database, std::path::Path::new(&path)).unwrap();
    database.import_snapshot(&snapshot).unwrap();
    let before = revision(&database, 1).unwrap();
    assert_eq!(before.len(), 64);
    assert_eq!(before, revision(&database, 1).unwrap());
    let expected = [Revision {
        track_id: 1,
        value: before.clone(),
    }];
    assert!(validate(&database, &[1], None, &expected).is_ok());
    let connection = rusqlite::Connection::open(database_path).unwrap();
    connection.execute(
        "INSERT INTO track_lyrics (track_id, no_lyrics) VALUES (1, 1) ON CONFLICT(track_id) DO UPDATE SET no_lyrics = 1",
        [],
    ).unwrap();
    let after = revision(&database, 1).unwrap();
    assert_ne!(before, after);
    assert!(validate(&database, &[1], None, &expected).is_err());
    std::fs::remove_file(&path).unwrap();
    assert_eq!(after, revision(&database, 1).unwrap());
}
