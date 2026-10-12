use super::*;
use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
use std::io::Cursor;

fn picture(color: [u8; 3]) -> Vec<u8> {
    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(RgbImage::from_pixel(8, 8, Rgb(color)))
        .write_to(&mut output, ImageFormat::Png)
        .unwrap();
    output.into_inner()
}

#[test]
fn downloads_once_and_existing_photos_skip_search_after_restart() {
    let temporary = tempfile::tempdir().unwrap();
    let writes = WriteState::default();
    let mut attempted = HashSet::new();
    assert!(lookup(
        temporary.path(),
        "Artist",
        &mut attempted,
        || Ok(Some(picture([255, 0, 0]))),
        &writes,
    )
    .unwrap());
    let saved = storage::read(temporary.path(), "Artist").unwrap();
    assert!(!saved.is_empty());
    assert!(!storage::searched(temporary.path(), "Artist").unwrap());
    attempted.clear();
    assert!(lookup(
        temporary.path(),
        "Artist",
        &mut attempted,
        || panic!("existing photo must not search"),
        &writes,
    )
    .unwrap());
    assert_eq!(storage::read(temporary.path(), "Artist").unwrap(), saved);
}

#[test]
fn missing_results_persist_across_restart_but_names_remain_distinct() {
    let temporary = tempfile::tempdir().unwrap();
    let writes = WriteState::default();
    let mut attempted = HashSet::new();
    assert!(!lookup(
        temporary.path(),
        "Missing",
        &mut attempted,
        || Ok(None),
        &writes
    )
    .unwrap());
    assert!(storage::searched(temporary.path(), "Missing").unwrap());
    assert!(storage::read(temporary.path(), "Missing")
        .unwrap()
        .is_empty());
    attempted.clear();
    assert!(!lookup(
        temporary.path(),
        "Missing",
        &mut attempted,
        || panic!("missing result must not search after restart"),
        &writes,
    )
    .unwrap());
    assert!(!lookup(
        temporary.path(),
        "missing",
        &mut attempted,
        || Ok(None),
        &writes
    )
    .unwrap());
    assert!(attempted.contains("missing"));
    storage::save(temporary.path(), "Missing", &picture([0, 0, 255])).unwrap();
    assert!(lookup(
        temporary.path(),
        "Missing",
        &mut attempted,
        || panic!("manual photo must override missing state"),
        &writes,
    )
    .unwrap());
}

#[test]
fn network_failures_retry_only_after_restart_and_never_persist_a_miss() {
    let temporary = tempfile::tempdir().unwrap();
    let writes = WriteState::default();
    let mut attempted = HashSet::new();
    assert!(lookup(
        temporary.path(),
        "Artist",
        &mut attempted,
        || Err("429".into()),
        &writes,
    )
    .is_err());
    assert!(!storage::searched(temporary.path(), "Artist").unwrap());
    assert!(!lookup(
        temporary.path(),
        "Artist",
        &mut attempted,
        || panic!("failed request must not retry in the same session"),
        &writes,
    )
    .unwrap());
    attempted.clear();
    assert!(lookup(
        temporary.path(),
        "Artist",
        &mut attempted,
        || Ok(Some(picture([255, 0, 0]))),
        &writes,
    )
    .unwrap());
}

#[test]
fn manual_save_during_download_wins_even_when_the_search_has_no_photo() {
    for downloaded in [Some(picture([255, 0, 0])), None] {
        let temporary = tempfile::tempdir().unwrap();
        let writes = WriteState::default();
        let mut attempted = HashSet::new();
        let mut manual = Vec::new();
        assert!(lookup(
            temporary.path(),
            "Artist",
            &mut attempted,
            || {
                let _guard = writes.acquire().unwrap();
                storage::save(temporary.path(), "Artist", &picture([0, 0, 255])).unwrap();
                manual = storage::read(temporary.path(), "Artist").unwrap();
                Ok(downloaded)
            },
            &writes,
        )
        .unwrap());
        assert_eq!(storage::read(temporary.path(), "Artist").unwrap(), manual);
        assert!(!storage::searched(temporary.path(), "Artist").unwrap());
        assert!(
            !storage::save_if_absent(temporary.path(), "Artist", &picture([255, 0, 0])).unwrap()
        );
        assert_eq!(storage::read(temporary.path(), "Artist").unwrap(), manual);
    }
}

#[test]
fn invalid_images_and_write_conflicts_do_not_become_missing_results() {
    let temporary = tempfile::tempdir().unwrap();
    let writes = WriteState::default();
    let mut attempted = HashSet::new();
    assert!(lookup(
        temporary.path(),
        "Invalid",
        &mut attempted,
        || Ok(Some(b"not an image".to_vec())),
        &writes,
    )
    .is_err());
    assert!(!storage::searched(temporary.path(), "Invalid").unwrap());
    assert!(!storage::exists(temporary.path(), "Invalid").unwrap());
    let _guard = writes.acquire().unwrap();
    assert!(lookup(
        temporary.path(),
        "Busy",
        &mut attempted,
        || Ok(None),
        &writes
    )
    .is_err());
    assert!(!storage::searched(temporary.path(), "Busy").unwrap());
    assert!(lookup(
        temporary.path(),
        " ",
        &mut attempted,
        || panic!("invalid name"),
        &writes
    )
    .is_err());
}
