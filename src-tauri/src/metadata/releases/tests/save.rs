use super::*;

#[test]
fn rejects_duplicate_targets_and_missing_cover() {
    let patch = || TrackPatch {
        track_id: 1,
        changes: vec![],
        write_cover: true,
    };
    assert!(validate_patches(&mut [patch()], None).is_err());
    let cover = CoverData {
        mime_type: "image/png".into(),
        data: vec![],
    };
    assert!(validate_patches(&mut [patch(), patch()], Some(&cover)).is_err());
    assert!(validate_patches(&mut [patch()], Some(&cover)).is_ok());
}

#[test]
fn rejects_empty_patches_and_lyrics() {
    assert!(validate_patches(&mut [], None).is_err());
    let mut unchanged = [TrackPatch {
        track_id: 1,
        changes: vec![],
        write_cover: false,
    }];
    assert!(validate_patches(&mut unchanged, None).is_err());
    let mut lyrics = [TrackPatch {
        track_id: 1,
        changes: vec![MetadataChange {
            values: Vec::new(),
            field: MetadataField::Lyrics,
            value: Some("lyrics".into()),
        }],
        write_cover: false,
    }];
    assert!(validate_patches(&mut lyrics, None)
        .unwrap_err()
        .contains("不支持写入歌词"));
}

#[test]
fn normalizes_independent_patches_and_preserves_cover_selection() {
    let cover = CoverData {
        mime_type: "image/png".into(),
        data: vec![],
    };
    let mut patches = [
        TrackPatch {
            track_id: 1,
            changes: vec![MetadataChange {
                values: Vec::new(),
                field: MetadataField::Title,
                value: Some(" first ".into()),
            }],
            write_cover: true,
        },
        TrackPatch {
            track_id: 2,
            changes: vec![MetadataChange {
                values: Vec::new(),
                field: MetadataField::TrackNumber,
                value: Some("02".into()),
            }],
            write_cover: false,
        },
    ];
    validate_patches(&mut patches, Some(&cover)).unwrap();
    assert_eq!(patches[0].changes[0].value.as_deref(), Some("first"));
    assert_eq!(patches[1].changes[0].value.as_deref(), Some("2"));
    assert!(patches[0].write_cover && !patches[1].write_cover);
}
