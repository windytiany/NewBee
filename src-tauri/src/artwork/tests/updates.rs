use super::ipc::{fixture, invoke};
use crate::{
    artwork::{get_album_artwork, get_track_artwork},
    database::{write::WriteState, Database},
    import::{directory::scan_music_library, files::import_music_files, tests::support::TestFiles},
    metadata::{
        files,
        releases::{save::save_album_tags, CoverData},
    },
};
use image::Rgba;
use lofty::{config::WriteOptions, file::TaggedFileExt, prelude::TagExt};
use tauri::Manager;

#[test]
fn scan_and_embedded_writes_refresh_thumbnails_without_destroying_other_shared_references() {
    let music = TestFiles::new();
    let one = music.wav("one.wav");
    let two = music.wav("two.wav");
    let red = fixture(Rgba([255, 0, 0, 255]));
    let blue = fixture(Rgba([0, 0, 255, 255]));
    let green = fixture(Rgba([0, 255, 0, 255]));
    let cover = music.write("cover.png", &red);
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&std::fs::canonicalize(&music.0).unwrap().to_string_lossy())
        .unwrap();
    let app = tauri::test::mock_builder()
        .manage(database)
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![
            get_track_artwork,
            get_album_artwork
        ])
        .build(tauri::generate_context!())
        .unwrap();
    let imported = tauri::async_runtime::block_on(import_music_files(
        vec![one.clone(), two.clone()],
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    assert_eq!(serde_json::to_value(imported).unwrap()["added"], 2);
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let read = |id| {
        files::access::take(&music.0);
        let bytes = invoke(
            &webview,
            "get_track_artwork",
            serde_json::json!({"trackId":id,"size":64}),
        )
        .unwrap();
        assert!(
            files::access::take(&music.0).is_empty(),
            "daily artwork must not access the music disk"
        );
        bytes
    };
    let color = |bytes: &[u8]| {
        image::load_from_memory(bytes)
            .unwrap()
            .to_rgba8()
            .get_pixel(32, 16)
            .0
    };
    let scan = || {
        let result = tauri::async_runtime::block_on(scan_music_library(
            None,
            app.handle().clone(),
            app.state(),
        ))
        .unwrap();
        assert_eq!(serde_json::to_value(result).unwrap()["updated"], 2);
    };
    let shared_red = read(1);
    assert_eq!(color(&shared_red), [255, 0, 0, 255]);
    assert_eq!(read(2), shared_red);
    assert_eq!(app.state::<Database>().artwork_decode_count(), 1);

    // Real cover write, verified independently from the database/thumbnail.
    let patches = serde_json::from_value(serde_json::json!([
        {"trackId":1,"changes":[],"writeCover":true}
    ]))
    .unwrap();
    let saved = tauri::async_runtime::block_on(save_album_tags(
        patches,
        Some(CoverData {
            mime_type: "image/png".into(),
            data: blue.clone(),
        }),
        tauri::ipc::Channel::new(|_| Ok(())),
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    assert!(saved[0].file_written && saved[0].database_updated);
    let mut tagged = lofty::read_from_path(&one).unwrap();
    assert_eq!(tagged.primary_tag().unwrap().pictures()[0].data(), blue);
    assert_eq!(color(&read(1)), [0, 0, 255, 255]);
    assert_eq!(read(2), shared_red);
    assert_eq!(app.state::<Database>().artwork_decode_count(), 2);
    scan();
    assert_eq!(color(&read(1)), [0, 0, 255, 255]);
    assert_eq!(app.state::<Database>().artwork_decode_count(), 2);

    // Confirmed embedded removal switches back to the still-shared directory image.
    let tag = tagged.primary_tag_mut().unwrap();
    tag.remove_picture(0);
    tag.save_to_path(&one, WriteOptions::default()).unwrap();
    scan();
    assert_eq!(read(1), shared_red);
    assert_eq!(app.state::<Database>().artwork_decode_count(), 2);

    // Directory replacement affects both associations, but generates only once.
    std::fs::write(&cover, &green).unwrap();
    scan();
    let shared_green = read(1);
    assert_eq!(color(&shared_green), [0, 255, 0, 255]);
    assert_eq!(read(2), shared_green);
    assert_eq!(app.state::<Database>().artwork_decode_count(), 3);
    assert_eq!(
        invoke(
            &webview,
            "get_album_artwork",
            serde_json::json!({"albumArtist":null,"album":null,"size":64})
        )
        .unwrap(),
        shared_green
    );
    assert_eq!(app.state::<Database>().artwork_decode_count(), 3);

    // Failed reads retain the last snapshot, unlike confirmed removal.
    std::fs::write(&cover, b"broken image").unwrap();
    scan();
    assert_eq!(read(1), shared_green);
    assert_eq!(read(2), shared_green);
    std::fs::remove_file(&cover).unwrap();
    scan();
    assert!(read(1).is_empty());
    assert!(read(2).is_empty());
    assert!(invoke(
        &webview,
        "get_album_artwork",
        serde_json::json!({"albumArtist":null,"album":null,"size":64})
    )
    .unwrap()
    .is_empty());
    assert_eq!(app.state::<Database>().artwork_decode_count(), 3);
}
