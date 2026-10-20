use super::*;
use crate::backup::restore;

#[test]
fn rejects_invalid_relations_and_session_before_modifying_original_data() {
    let source = Directory::new();
    let target = Directory::new();
    fs::write(target.0.join("settings.json"), "original").unwrap();
    let file = source.0.join("backup.newbee");
    make_backup(&source.0, &file);
    let connection = Connection::open(&file).unwrap();
    connection
        .execute_batch("PRAGMA foreign_keys = OFF;")
        .unwrap();
    connection
        .execute(
            "INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (99, 99, 0)",
            [],
        )
        .unwrap();
    drop(connection);
    fs::copy(file, target.0.join(restore::PENDING_FILE)).unwrap();
    assert!(apply_pending_restore(&target.0).is_err());
    assert_eq!(
        fs::read_to_string(target.0.join("settings.json")).unwrap(),
        "original"
    );
    let mut invalid = manifest();
    invalid.session.volume.volume = 101;
    assert!(invalid.validate().is_err());
}
