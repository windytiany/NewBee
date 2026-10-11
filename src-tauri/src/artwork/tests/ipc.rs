use super::super::{get_album_artwork, get_track_artwork};
use crate::artwork::model::ArtworkContent;
use crate::database::{model::TrackWriteInput, Database};
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use std::io::Cursor;
use tauri::ipc::{InvokeBody, InvokeResponseBody};
use tauri::Manager;

pub(super) fn assert_color(actual: [u8; 4], expected: [u8; 4]) {
    for channel in 0..3 {
        assert!(
            actual[channel].abs_diff(expected[channel]) <= 3,
            "actual={actual:?} expected={expected:?}"
        );
    }
    assert_eq!(actual[3], expected[3]);
}

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

fn webview(database: Database) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
    let app = tauri::test::mock_builder()
        .manage(database)
        .invoke_handler(tauri::generate_handler![
            get_track_artwork,
            get_album_artwork
        ])
        .build(tauri::generate_context!())
        .unwrap();
    tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap()
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
    let webview = webview(database);
    assert_eq!(
        invoke(
            &webview,
            "get_track_artwork",
            serde_json::json!({"trackId":1,"size":null})
        )
        .unwrap(),
        red
    );
    for (id, expected) in [(1, [255, 0, 0, 255]), (2, [0, 0, 255, 255])] {
        let bytes = invoke(
            &webview,
            "get_track_artwork",
            serde_json::json!({"trackId":id,"size":128}),
        )
        .unwrap();
        assert_eq!(&bytes[8..12], b"WEBP");
        assert!(bytes.windows(4).any(|bytes| bytes == b"VP8 "));
        let image = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(image.dimensions(), (128, 64));
        assert_color(image.get_pixel(64, 32).0, expected);
        assert!(bytes.len() < 10_000);
    }
    assert_eq!(
        invoke(
            &webview,
            "get_album_artwork",
            serde_json::json!({"albumArtist":"Artist","album":"Album"})
        )
        .unwrap(),
        red
    );
    for size in [None, Some(128)] {
        assert!(invoke(
            &webview,
            "get_track_artwork",
            serde_json::json!({"trackId":3,"size":size})
        )
        .unwrap()
        .is_empty());
    }
    assert!(invoke(
        &webview,
        "get_track_artwork",
        serde_json::json!({"trackId":4,"size":128})
    )
    .is_err());
    webview
        .state::<Database>()
        .upsert_track(
            &track("/fixture/one.mp3", fixture(Rgba([0, 255, 0, 255]))),
            crate::database::ArtworkUpdate::Embedded,
        )
        .unwrap();
    let updated = invoke(
        &webview,
        "get_track_artwork",
        serde_json::json!({"trackId":1,"size":128}),
    )
    .unwrap();
    assert_color(
        image::load_from_memory(&updated)
            .unwrap()
            .to_rgba8()
            .get_pixel(64, 32)
            .0,
        [0, 255, 0, 255],
    );
    assert!(invoke(
        &webview,
        "get_track_artwork",
        serde_json::json!({"trackId":999,"size":null})
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
    let webview = webview(database);
    let mut thumbnail_bytes = 0;
    for id in 1..=40 {
        let bytes = invoke(
            &webview,
            "get_track_artwork",
            serde_json::json!({"trackId":id,"size":128}),
        )
        .unwrap();
        assert_eq!(
            image::load_from_memory(&bytes)
                .unwrap()
                .to_rgba8()
                .dimensions(),
            (128, 128)
        );
        thumbnail_bytes += bytes.len();
    }
    assert_eq!(webview.state::<Database>().artwork_decode_count(), 1);
    assert!(thumbnail_bytes < 1_000_000);
    assert!(thumbnail_bytes < previous_json_bytes);
}

#[test]
fn requested_sizes_reuse_shared_images_across_database_reopen_without_decoding() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("library.sqlite3");
    let cache = directory.path().join("cache");
    let database = Database::open_with_cache(&path, &cache).unwrap();
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
    let view = webview(database);
    assert_eq!(view.state::<Database>().artwork_decode_count(), 0);
    let first = invoke(
        &view,
        "get_track_artwork",
        serde_json::json!({"trackId":1,"size":128}),
    )
    .unwrap();
    assert_eq!(
        image::load_from_memory(&first)
            .unwrap()
            .to_rgba8()
            .dimensions(),
        (128, 64)
    );
    assert_eq!(view.state::<Database>().artwork_decode_count(), 1);
    assert_eq!(
        invoke(
            &view,
            "get_track_artwork",
            serde_json::json!({"trackId":2,"size":128})
        )
        .unwrap(),
        first
    );
    assert_eq!(
        invoke(
            &view,
            "get_album_artwork",
            serde_json::json!({"albumArtist":"Artist","album":"Album","size":128})
        )
        .unwrap(),
        first
    );
    assert_eq!(view.state::<Database>().artwork_decode_count(), 1);
    let large = invoke(
        &view,
        "get_track_artwork",
        serde_json::json!({"trackId":1,"size":512}),
    )
    .unwrap();
    assert_eq!(
        image::load_from_memory(&large)
            .unwrap()
            .to_rgba8()
            .dimensions(),
        (512, 256)
    );
    assert_eq!(view.state::<Database>().artwork_decode_count(), 2);
    view.state::<Database>().close_test_connection();
    drop(view);
    let view = webview(Database::open_with_cache(&path, &cache).unwrap());
    for id in [1, 2] {
        assert_eq!(
            invoke(
                &view,
                "get_track_artwork",
                serde_json::json!({"trackId":id,"size":128})
            )
            .unwrap(),
            first
        );
    }
    assert_eq!(
        invoke(
            &view,
            "get_track_artwork",
            serde_json::json!({"trackId":1,"size":512})
        )
        .unwrap(),
        large
    );
    assert_eq!(view.state::<Database>().artwork_decode_count(), 0);
    view.state::<Database>().close_test_connection();
    drop(view);
    // Evict the entire cache while keeping the offline library snapshot.
    std::fs::remove_dir_all(&cache).unwrap();
    let view = webview(Database::open_with_cache(&path, &cache).unwrap());
    assert_eq!(
        invoke(
            &view,
            "get_track_artwork",
            serde_json::json!({"trackId":1,"size":128})
        )
        .unwrap(),
        first
    );
    assert_eq!(view.state::<Database>().artwork_decode_count(), 1);
    view.state::<Database>().close_test_connection();
}

#[test]
fn artwork_commands_accept_only_the_three_shared_sizes() {
    let webview = webview(Database::open(":memory:").unwrap());
    for command in ["get_track_artwork", "get_album_artwork"] {
        for size in super::super::request::SIZES {
            assert!(invoke(
                &webview,
                command,
                serde_json::json!({"trackId":999,"size":size})
            )
            .unwrap()
            .is_empty());
        }
        for size in [0, 1, 80, 129, 513, 2049, 4096] {
            assert_eq!(
                invoke(
                    &webview,
                    command,
                    serde_json::json!({"trackId":999,"size":size})
                )
                .unwrap_err(),
                "封面尺寸必须为 128、512 或 2048"
            );
        }
    }
}

#[test]
fn transparent_background_colour_does_not_bleed_into_downscaled_edges() {
    let image = RgbaImage::from_fn(384, 384, |x, _| {
        if x % 3 == 0 {
            Rgba([255, 255, 255, 255])
        } else {
            Rgba([0, 0, 0, 0])
        }
    });
    let mut original = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut original, ImageFormat::Png)
        .unwrap();
    let bytes = super::super::encoding::thumbnail(original.get_ref(), 128).unwrap();
    let decoded = image::load_from_memory(&bytes).unwrap().to_rgba8();
    assert_eq!(decoded.dimensions(), (128, 128));
    let mut translucent = 0;
    for pixel in decoded.pixels() {
        if pixel[3] > 0 && pixel[3] < 255 {
            translucent += 1;
            assert!(
                pixel.0[..3].iter().all(|channel| *channel >= 252),
                "dark alpha fringe: {pixel:?}"
            );
        }
    }
    assert!(translucent > 0);
}

#[test]
fn alpha_edges_survive_lossy_encoding_without_upscaling_small_originals() {
    let database = Database::open(":memory:").unwrap();
    let image = RgbaImage::from_fn(32, 32, |x, _| Rgba([255, 255, 255, (x * 8).min(255) as u8]));
    let mut original = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image.clone())
        .write_to(&mut original, ImageFormat::Png)
        .unwrap();
    let bytes = super::super::thumbnail(&database, original.into_inner(), 512).unwrap();
    assert!(bytes.windows(4).any(|bytes| bytes == b"VP8 "));
    let decoded = image::load_from_memory(&bytes).unwrap().to_rgba8();
    assert_eq!(decoded.dimensions(), image.dimensions());
    for (expected, actual) in image.pixels().zip(decoded.pixels()) {
        assert_eq!(actual[3], expected[3]);
        if actual[3] > 0 {
            assert_color(actual.0, expected.0);
        }
    }
}
