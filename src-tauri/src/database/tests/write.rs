use super::WriteState;

#[test]
fn scan_and_import_share_an_exclusive_guard_that_releases_on_drop() {
    let state = WriteState::default();
    let guard = state.acquire().unwrap();
    assert!(state.acquire().is_err());
    drop(guard);
    assert!(state.acquire().is_ok());
}
