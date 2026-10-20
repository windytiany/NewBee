use super::*;

#[test]
fn artwork_failure_never_publishes_and_readers_use_confirmed_snapshots_offline() {
    let fixture = TestFiles::new();
    let path = canonical(fixture.wav("track.wav"));
    let cover = fixture.write("cover.png", include_bytes!("../../../fixtures/cover.png"));
    let database = Database::open(":memory:").unwrap();
    files::write_file(Path::new(&path), &[title("Confirmed")]).unwrap();
    assert!(register(&database, vec![path.clone()])[0].success);
    let track_id = id(&database, &path);
    let bytes = database
        .track_artwork_bytes(track_id, None, |_, _| unreachable!())
        .unwrap();
    assert_eq!(bytes, include_bytes!("../../../fixtures/cover.png"));
    assert_eq!(
        database
            .get_artwork_collection(track_id)
            .unwrap()
            .images
            .len(),
        1
    );
    files::write_file(Path::new(&path), &[title("Unconfirmed")]).unwrap();
    std::fs::write(&cover, b"bad image").unwrap();
    assert!(!register(&database, vec![path.clone()])[0].success);
    assert!(!ingest(&database, vec![track_id])[0].success);
    assert!(crate::tracks::reread(&database, track_id).is_err());
    assert_eq!(
        database
            .get_track(track_id)
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("Confirmed")
    );
    assert_eq!(database.inbox_paths().unwrap(), std::slice::from_ref(&path));
    std::fs::remove_file(&path).unwrap();
    std::fs::remove_file(&cover).unwrap();
    files::access::take(&fixture.0);
    assert_eq!(refresh(&database).unwrap().tracks[0].track.id, track_id);
    assert_eq!(
        database.get_editing_snapshot(track_id).unwrap().values[&MetadataField::Title],
        "Confirmed"
    );
    assert_eq!(
        database
            .track_artwork_bytes(track_id, None, |_, _| unreachable!())
            .unwrap(),
        bytes
    );
    assert_eq!(
        database.describe_artwork_collections(&[track_id]).unwrap()[0]
            .pictures
            .len(),
        1
    );
    assert!(files::access::take(&fixture.0).is_empty());
    database.remove_inbox_track(track_id).unwrap();
    assert!(database.inbox_paths().unwrap().is_empty());
    assert!(database.get_track(track_id).unwrap().is_some());
}

#[test]
fn inbox_reopens_with_complete_snapshot_and_enforces_track_foreign_key() {
    let fixture = TestFiles::new();
    let path = canonical(fixture.wav("track.wav"));
    let storage = fixture.0.join("library.sqlite3");
    let database = Database::open(&storage).unwrap();
    files::write_file(
        Path::new(&path),
        &[
            title("Confirmed"),
            MetadataChange {
                field: MetadataField::Lyrics,
                value: Some("Embedded lyrics".into()),
                values: Vec::new(),
            },
        ],
    )
    .unwrap();
    std::fs::write(Path::new(&path).with_extension("lrc"), "Sidecar lyrics").unwrap();
    assert!(register(&database, vec![path.clone()])[0].success);
    let track_id = id(&database, &path);
    let editing = database.get_editing_snapshot(track_id).unwrap();
    assert!(editing.writable_fields.contains(&MetadataField::Title));
    assert!(editing.writable_fields.contains(&MetadataField::Lyrics));
    assert_eq!(editing.values[&MetadataField::Lyrics], "Embedded lyrics");
    assert_eq!(
        database.get_lyrics(track_id).unwrap().text.as_deref(),
        Some("Embedded lyrics")
    );
    let snapshot = serde_json::to_value(editing).unwrap();
    database
        .connection()
        .unwrap()
        .execute("UPDATE inbox SET added_at=123", [])
        .unwrap();
    drop(database);
    std::fs::remove_file(&path).unwrap();
    let database = Database::open(&storage).unwrap();
    files::access::take(&fixture.0);
    let read = serde_json::to_value(refresh(&database).unwrap()).unwrap();
    assert_eq!(read["tracks"][0]["id"], track_id);
    assert_eq!(read["tracks"][0]["addedAt"], 123);
    assert_eq!(read["tracks"][0]["title"], "Confirmed");
    assert!(read["tracks"][0].get("lyrics").is_none());
    assert_eq!(
        serde_json::to_value(database.get_editing_snapshot(track_id).unwrap()).unwrap(),
        snapshot
    );
    assert!(files::access::take(&fixture.0).is_empty());
    let connection = database.connection().unwrap();
    assert!(connection
        .execute("INSERT INTO inbox(track_id,added_at) VALUES (999,1)", [])
        .is_err());
    connection
        .execute("DELETE FROM tracks WHERE id=?1", [track_id])
        .unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM inbox", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        0
    );
}
