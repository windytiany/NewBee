use super::*;

#[test]
fn protects_application_files_from_export_overwrites() {
    let directory = Directory::new();
    fs::write(directory.0.join("settings.json"), "original").unwrap();
    assert!(validate_export_destination(&directory.0, &directory.0.join("settings.json")).is_err());
    fs::create_dir(directory.0.join("backups")).unwrap();
    assert!(
        validate_export_destination(&directory.0, &directory.0.join("backups/safety.newbee"))
            .is_ok()
    );
}
