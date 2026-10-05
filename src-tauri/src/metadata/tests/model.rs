use super::support::change;
use crate::metadata::model::{normalize_changes, MetadataField};

#[test]
fn validates_dates_numbers_and_explicit_clearing() {
    for date in ["2024", "2024-02", "2024-02-29"] {
        assert!(normalize_changes(&mut [change(MetadataField::ReleaseDate, Some(date))]).is_ok());
    }
    for date in [
        "2023-02-29",
        "2024-13",
        "0000",
        "2024-2",
        "2024-04-31",
        "２０２４",
    ] {
        assert!(normalize_changes(&mut [change(MetadataField::ReleaseDate, Some(date))]).is_err());
    }
    for number in ["0", "-1", "1.5", "4294967296"] {
        assert!(
            normalize_changes(&mut [change(MetadataField::TrackNumber, Some(number))]).is_err()
        );
    }
    let mut changes = [
        change(MetadataField::Title, Some("  ")),
        change(MetadataField::TrackNumber, Some(" 002 ")),
    ];
    normalize_changes(&mut changes).unwrap();
    assert!(changes[0].value.is_none());
    assert_eq!(changes[1].value.as_deref(), Some("2"));
    assert!(normalize_changes(&mut [
        change(MetadataField::Title, None),
        change(MetadataField::Title, Some("x"))
    ])
    .is_err());
}
