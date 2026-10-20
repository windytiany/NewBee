use super::*;

#[test]
fn data_directory_is_exclusively_locked_until_the_application_releases_it() {
    let directory = Directory::new();
    let first = lock_data_directory(&directory.0).unwrap();
    assert!(lock_data_directory(&directory.0).is_err());
    drop(first);
    assert!(lock_data_directory(&directory.0).is_ok());
}
