use super::*;
use crate::database::tests::support::insert_track;

#[test]
fn failed_restore_and_active_editing_each_skip_collection() {
    let database = Database::open(":memory:").unwrap();
    insert_track(&database, 1, None, None, 1, None);
    database
        .connection()
        .unwrap()
        .execute("UPDATE tracks SET in_library = 0 WHERE id = 1", [])
        .unwrap();
    let write = WriteState::default();
    cleanup(&database, &write, Err("session_load_failed"));
    assert!(database.get_track(1).unwrap().is_some());
    cleanup(&database, &write, Err("session_restore_incomplete"));
    assert!(database.get_track(1).unwrap().is_some());
    let guard = write.acquire().unwrap();
    cleanup(&database, &write, Ok(References::default()));
    assert!(database.get_track(1).unwrap().is_some());
    drop(guard);
    cleanup(&database, &write, Ok(References::default()));
    assert!(database.get_track(1).unwrap().is_none());
}
