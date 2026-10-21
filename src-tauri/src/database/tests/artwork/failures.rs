use super::*;

#[test]
fn invalid_directory_cover_reports_a_problem_and_retains_the_path() {
    let library = ArtworkLibrary::new();
    let audio = library.files.wav("one.wav");
    let cover = include_bytes!("../../../../fixtures/cover.png");
    let path = library.files.write("cover.png", cover);
    library.scan();
    let playlist = library
        .app
        .state::<Database>()
        .create_playlist("Favorites")
        .unwrap();
    library
        .app
        .state::<Database>()
        .append_playlist_tracks(playlist, vec![1])
        .unwrap();
    // A lower-priority valid image does not hide failure of the chosen source.
    library.files.write(
        "folder.png",
        &image_fixture([255, 0, 0], image::ImageFormat::Png),
    );
    std::fs::write(&path, b"not an image").unwrap();
    assert_eq!(library.scan()["failed"], 1);
    assert_eq!(artwork(&library.webview, 1), cover);
    let collection = library
        .app
        .state::<Database>()
        .get_artwork_collection(1)
        .unwrap();
    assert_eq!(collection.images.len(), 1);
    assert_eq!(collection.display_index, Some(0));
    assert_eq!(
        collection.images[0].path,
        crate::artwork::track::linked::normalize(&path).unwrap()
    );
    assert!(collection.images[0].error.is_none());
    assert!(library
        .app
        .state::<Database>()
        .get_editing_snapshot(1)
        .unwrap()
        .issue
        .is_none());
    library.reopen();
    assert_eq!(artwork(&library.webview, 1), cover);
    assert_eq!(std::fs::read(&path).unwrap(), b"not an image");
    std::fs::write(&path, cover).unwrap();
    assert_eq!(library.scan()["failed"], 0);
    assert!(library
        .app
        .state::<Database>()
        .get_editing_snapshot(1)
        .unwrap()
        .issue
        .is_none());
    let before =
        serde_json::to_value(library.app.state::<Database>().get_track(1).unwrap()).unwrap();
    std::fs::write(&audio, b"broken audio").unwrap();
    assert_eq!(library.scan()["failed"], 1);
    assert_eq!(artwork(&library.webview, 1), cover);
    assert_eq!(
        serde_json::to_value(library.app.state::<Database>().get_track(1).unwrap()).unwrap(),
        before
    );
    std::fs::remove_file(audio).unwrap();
    assert_eq!(library.scan()["failed"], 0);
    let snapshot = crate::library::synchronization::get_library_synchronization(
        library.app.state(),
        library.app.state(),
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(snapshot).unwrap()["missing"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(artwork(&library.webview, 1), cover);
    assert_eq!(
        library
            .app
            .state::<Database>()
            .list_playlist_tracks(playlist)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        serde_json::to_value(library.app.state::<Database>().get_track(1).unwrap()).unwrap(),
        before
    );
}

#[cfg(windows)]
#[test]
fn unreadable_directory_cover_is_not_treated_as_removal() {
    use std::os::windows::fs::OpenOptionsExt;
    let library = ArtworkLibrary::new();
    library.files.wav("one.wav");
    let cover = include_bytes!("../../../../fixtures/cover.png");
    let path = library.files.write("cover.png", cover);
    library.scan();
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    assert_eq!(library.scan()["failed"], 1);
    assert_eq!(artwork(&library.webview, 1), cover);
    let collection = library
        .app
        .state::<Database>()
        .get_artwork_collection(1)
        .unwrap();
    assert_eq!(collection.images.len(), 1);
    assert_eq!(
        collection.images[0].path,
        crate::artwork::track::linked::normalize(&path).unwrap()
    );
    assert!(collection.images[0].error.is_none());
    assert!(library
        .app
        .state::<Database>()
        .get_editing_snapshot(1)
        .unwrap()
        .issue
        .is_none());
    drop(lock);
    assert_eq!(std::fs::read(&path).unwrap(), cover);
    assert_eq!(artwork(&library.webview, 1), cover);
    assert_eq!(library.scan()["failed"], 0);
    std::fs::remove_file(path).unwrap();
    library.scan();
    assert!(artwork(&library.webview, 1).is_empty());
}
