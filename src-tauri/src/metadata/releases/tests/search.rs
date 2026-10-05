use super::super::*;
#[test]
#[ignore = "requires MusicBrainz and Cover Art Archive network access"]
fn live_release_search_details_and_cover() {
    let raw: RawSearch = musicbrainz(
        "release/",
        &[
            (
                "query",
                "release:\"Dummy\" AND artist:\"Portishead\"".into(),
            ),
            ("limit", "1".into()),
        ],
    )
    .unwrap();
    assert!(raw.count > 0);
    let id = "76df3287-6cda-33eb-8e9a-044b5e15ffdd";
    let details = tauri::async_runtime::block_on(get_album_release(id.into())).unwrap();
    let value = serde_json::to_value(details).unwrap();
    assert_eq!(value["summary"]["title"], "Dummy");
    assert_eq!(value["tracks"].as_array().unwrap().len(), 11);
    let covers = tauri::async_runtime::block_on(get_release_covers(id.into())).unwrap();
    assert!(!covers.is_empty());
    let cover =
        tauri::async_runtime::block_on(get_release_cover(id.into(), covers[0].id.clone())).unwrap();
    assert!(!cover.data.is_empty());
}

#[test]
fn validates_ids_and_escapes_search_syntax() {
    assert!(valid_id("76df3287-6cda-33eb-8e9a-044b5e15ffdd"));
    assert!(!valid_id("../../localhost"));
    assert_eq!(literal("A \"B\" + C"), "\"A \\\"B\\\" \\+ C\"");
}
