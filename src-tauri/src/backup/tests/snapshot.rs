use super::*;

#[test]
fn snapshots_committed_wal_data_without_copying_live_sidecars() {
    let directory = Directory::new();
    let database = fixture(&directory.0);
    let connection = Connection::open(directory.0.join("music-library.sqlite3")).unwrap();
    connection.execute_batch("PRAGMA journal_mode = WAL; INSERT INTO tracks (path, title) VALUES ('/new.flac', 'new song');").unwrap();
    assert!(directory.0.join("music-library.sqlite3-wal").exists());
    let destination = directory.0.join("wal.newbee");
    archive::write(&database, &manifest(), &destination).unwrap();
    archive::read(&destination).unwrap();
    let snapshot = Connection::open(&destination).unwrap();
    let count: i64 = snapshot
        .query_row("SELECT count(*) FROM tracks", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 2);
    assert!(!directory.0.join("wal.newbee-wal").exists());
}
