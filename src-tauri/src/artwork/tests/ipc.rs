use super::super::{get_album_artwork, get_track_artwork};
use crate::database::{ArtworkContent, Database, TrackWriteInput};
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use std::io::Cursor;
use tauri::ipc::{InvokeBody, InvokeResponseBody};
use tauri::Manager;

fn track(path: &str, image: Vec<u8>) -> TrackWriteInput {
    TrackWriteInput {
        path: path.into(),
        title: None,
        artist: None,
        album: Some("Album".into()),
        album_artist: Some("Artist".into()),
        release_date: None,
        disc_number: None,
        track_number: None,
        disc_total: None,
        track_total: None,
        duration_ms: None,
        codec: None,
        sample_rate_hz: None,
        bitrate_kbps: None,
        channels: None,
        artwork: Some(ArtworkContent {
            mime_type: "image/png".into(),
            image,
        }),
        editing: None,
        lyrics: None,
    }
}

pub(super) fn fixture(color: Rgba<u8>) -> Vec<u8> {
    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(RgbaImage::from_pixel(1200, 600, color))
        .write_to(&mut output, ImageFormat::Png)
        .unwrap();
    output.into_inner()
}

pub(super) fn invoke(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    args: serde_json::Value,
) -> Result<Vec<u8>, serde_json::Value> {
    tauri::test::get_ipc_response(
        webview,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .map(|response| match response {
        InvokeResponseBody::Raw(bytes) => bytes,
        InvokeResponseBody::Json(_) => panic!("Artwork must not use JSON byte arrays"),
    })
}

#[test]
fn ipc_returns_small_track_specific_thumbnails_and_unchanged_binary_originals() {
    let database = Database::open(":memory:").unwrap();
    let red = fixture(Rgba([255, 0, 0, 255]));
    let blue = fixture(Rgba([0, 0, 255, 255]));
    database
        .upsert_track(
            &track("/fixture/one.mp3", red.clone()),
            crate::database::ArtworkUpdate::Embedded,
        )
        .unwrap();
    database
        .upsert_track(
            &track("/fixture/two.mp3", blue),
            crate::database::ArtworkUpdate::Embedded,
        )
        .unwrap();
    let mut missing = track("/fixture/missing.mp3", Vec::new());
    missing.artwork = None;
    database
        .upsert_track(&missing, crate::database::ArtworkUpdate::Embedded)
        .unwrap();
    database
        .upsert_track(
            &track("/fixture/corrupt.mp3", vec![1, 2, 3]),
            crate::database::ArtworkUpdate::Embedded,
        )
        .unwrap();
    let app = tauri::test::mock_builder()
        .manage(database)
        .invoke_handler(tauri::generate_handler![
            get_track_artwork,
            get_album_artwork
        ])
        .build(tauri::generate_context!())
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let original = invoke(
        &webview,
        "get_track_artwork",
        serde_json::json!({"trackId": 1, "size": null}),
    )
    .unwrap();
    assert_eq!(original, red);
    for (id, expected) in [(1, [255, 0, 0, 255]), (2, [0, 0, 255, 255])] {
        let bytes = invoke(
            &webview,
            "get_track_artwork",
            serde_json::json!({"trackId": id, "size": 80}),
        )
        .unwrap();
        let image = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(image.dimensions(), (80, 40));
        assert_eq!(image.get_pixel(40, 20).0, expected);
        assert!(bytes.len() < 10_000);
    }
    let album = invoke(
        &webview,
        "get_album_artwork",
        serde_json::json!({"albumArtist": "Artist", "album": "Album"}),
    )
    .unwrap();
    assert_eq!(album, red);
    for size in [None, Some(80)] {
        assert!(invoke(
            &webview,
            "get_track_artwork",
            serde_json::json!({"trackId": 3, "size": size})
        )
        .unwrap()
        .is_empty());
    }
    assert!(invoke(
        &webview,
        "get_track_artwork",
        serde_json::json!({"trackId": 4, "size": 80})
    )
    .is_err());
    app.state::<Database>()
        .upsert_track(
            &track("/fixture/one.mp3", fixture(Rgba([0, 255, 0, 255]))),
            crate::database::ArtworkUpdate::Embedded,
        )
        .unwrap();
    let updated = invoke(
        &webview,
        "get_track_artwork",
        serde_json::json!({"trackId": 1, "size": 80}),
    )
    .unwrap();
    assert_eq!(
        image::load_from_memory(&updated)
            .unwrap()
            .to_rgba8()
            .get_pixel(40, 20)
            .0,
        [0, 255, 0, 255]
    );
    assert!(invoke(
        &webview,
        "get_track_artwork",
        serde_json::json!({"trackId": 999, "size": null})
    )
    .unwrap()
    .is_empty());
}

#[test]
fn forty_large_covers_cross_ipc_as_thumbnails_not_full_json_images() {
    let mut seed = 42_u32;
    let image = RgbaImage::from_fn(600, 600, |_, _| {
        let mut pixel = [0; 4];
        for channel in &mut pixel {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            *channel = seed as u8;
        }
        Rgba(pixel)
    });
    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut output, ImageFormat::Png)
        .unwrap();
    let original = output.into_inner();
    assert!(original.len() > 1_000_000);
    let database = Database::open(":memory:").unwrap();
    for index in 0..40 {
        database
            .upsert_track(
                &track(&format!("/fixture/{index}.mp3"), original.clone()),
                crate::database::ArtworkUpdate::Embedded,
            )
            .unwrap();
    }
    let previous_json_bytes = serde_json::to_vec(&database.get_track_artwork(1).unwrap())
        .unwrap()
        .len()
        * 40;
    let app = tauri::test::mock_builder()
        .manage(database)
        .invoke_handler(tauri::generate_handler![get_track_artwork])
        .build(tauri::generate_context!())
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let mut thumbnail_bytes = 0;
    for id in 1..=40 {
        let bytes = invoke(
            &webview,
            "get_track_artwork",
            serde_json::json!({"trackId": id, "size": 80}),
        )
        .unwrap();
        assert_eq!(
            image::load_from_memory(&bytes)
                .unwrap()
                .to_rgba8()
                .dimensions(),
            (80, 80)
        );
        thumbnail_bytes += bytes.len();
    }
    assert_eq!(app.state::<Database>().artwork_decode_count(), 1);
    assert!(thumbnail_bytes < 1_000_000);
    assert!(thumbnail_bytes < previous_json_bytes);
}

#[test]
fn requested_sizes_reuse_shared_images_across_database_reopen_without_decoding() {
    let path = std::env::temp_dir().join(format!("newbee-thumbnail-{}.sqlite", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let database = Database::open(&path).unwrap();
    let red = fixture(Rgba([255, 0, 0, 255]));
    for (name, update) in [
        ("one", crate::database::ArtworkUpdate::Embedded),
        (
            "two",
            crate::database::ArtworkUpdate::Directory("/offline/cover.png".into()),
        ),
    ] {
        database
            .upsert_track(&track(&format!("/offline/{name}.mp3"), red.clone()), update)
            .unwrap();
    }
    let app = tauri::test::mock_builder()
        .manage(database)
        .invoke_handler(tauri::generate_handler![
            get_track_artwork,
            get_album_artwork
        ])
        .build(tauri::generate_context!())
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    assert_eq!(app.state::<Database>().artwork_decode_count(), 0);
    let first = invoke(
        &webview,
        "get_track_artwork",
        serde_json::json!({"trackId":1,"size":40}),
    )
    .unwrap();
    assert_eq!(
        image::load_from_memory(&first)
            .unwrap()
            .to_rgba8()
            .dimensions(),
        (40, 20)
    );
    assert_eq!(app.state::<Database>().artwork_decode_count(), 1);
    let shared = invoke(
        &webview,
        "get_track_artwork",
        serde_json::json!({"trackId":2,"size":40}),
    )
    .unwrap();
    assert_eq!(first, shared);
    let album = invoke(
        &webview,
        "get_album_artwork",
        serde_json::json!({"albumArtist":"Artist","album":"Album","size":40}),
    )
    .unwrap();
    assert_eq!(first, album);
    assert_eq!(app.state::<Database>().artwork_decode_count(), 1);
    let large = invoke(
        &webview,
        "get_track_artwork",
        serde_json::json!({"trackId":1,"size":160}),
    )
    .unwrap();
    assert_eq!(
        image::load_from_memory(&large)
            .unwrap()
            .to_rgba8()
            .dimensions(),
        (160, 80)
    );
    assert_eq!(app.state::<Database>().artwork_decode_count(), 2);
    drop(webview);
    app.state::<Database>().close_test_connection();
    drop(app);
    let database = Database::open(&path).unwrap();
    let app = tauri::test::mock_builder()
        .manage(database)
        .invoke_handler(tauri::generate_handler![
            get_track_artwork,
            get_album_artwork
        ])
        .build(tauri::generate_context!())
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    for id in [1, 2] {
        assert_eq!(
            invoke(
                &webview,
                "get_track_artwork",
                serde_json::json!({"trackId":id,"size":40})
            )
            .unwrap(),
            first
        );
    }
    assert_eq!(
        invoke(
            &webview,
            "get_track_artwork",
            serde_json::json!({"trackId":1,"size":160})
        )
        .unwrap(),
        large
    );
    assert_eq!(app.state::<Database>().artwork_decode_count(), 0);
    drop(webview);
    app.state::<Database>().close_test_connection();
    drop(app);
    std::fs::remove_file(path).unwrap();
}
