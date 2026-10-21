#[cfg(windows)]
#[test]
fn junction_temp_directory_preserves_scanned_artwork_identity() {
    use std::process::Command;

    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    let target = root.join("target");
    let alias = root.join("alias");
    std::fs::create_dir(&target).unwrap();
    let junction = Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&alias)
        .arg(&target)
        .output()
        .unwrap();
    assert!(
        junction.status.success(),
        "Could not create junction: {} {}",
        String::from_utf8_lossy(&junction.stdout),
        String::from_utf8_lossy(&junction.stderr)
    );
    assert_ne!(alias, alias.canonicalize().unwrap());

    let tests = [
        "database::tests::collection::directory_discovery_and_manual_association_share_only_the_same_path_identity",
        "database::tests::artwork::scanning::repeated_scans_share_content_and_missing_paths_retain_associations",
        "database::tests::artwork::failures::invalid_directory_cover_reports_a_problem_and_retains_the_path",
        "database::tests::artwork::failures::unreadable_directory_cover_is_not_treated_as_removal",
        "metadata::tests::library::scanned_shared_cover_survives_targeted_file_save_and_cold_thumbnail_reuse",
        "library::synchronization::tests::scan::rejects_roots_that_no_longer_match_the_saved_canonical_path",
    ];
    // Change TEMP only in a child process so parallel tests keep their own environment.
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "--nocapture", "--test-threads=1"])
        .args(tests)
        .env("TEMP", &alias)
        .env("TMP", &alias)
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "Artwork tests failed with a junction temporary directory ({}):\n{stdout}\n{stderr}",
        output.status
    );
    for test in tests {
        assert!(
            stdout.contains(&format!("test {test} ... ok")),
            "Test did not pass: {test}\n{stdout}"
        );
    }
}
