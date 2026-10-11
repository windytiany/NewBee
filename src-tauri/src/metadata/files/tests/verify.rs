use super::{
    verify_changes, verify_tag_items, ItemKey, MetadataChange, MetadataField, Tag, TagType,
};
use lofty::tag::{ItemValue, TagItem};

#[test]
fn allows_empty_removal_number_formatting_and_item_reordering() {
    let mut expected = Tag::new(TagType::Id3v2);
    expected.insert_text(ItemKey::Genre, String::new());
    expected.insert_text(ItemKey::TrackNumber, "02".into());
    expected.insert_text(ItemKey::TrackTotal, "012".into());
    expected.insert_text(ItemKey::TrackTitle, "keep".into());
    let mut actual = Tag::new(TagType::Id3v2);
    actual.insert_text(ItemKey::TrackTitle, "keep".into());
    actual.insert_text(ItemKey::TrackTotal, "12".into());
    actual.insert_text(ItemKey::TrackNumber, "2".into());
    assert!(verify_tag_items(&expected, &actual).is_ok());
    actual.insert_text(ItemKey::TrackNumber, "3".into());
    let error = verify_tag_items(&expected, &actual).unwrap_err();
    assert!(error.contains("Id3v2"));
    assert!(error.contains("TrackNumber"));
}

#[test]
fn cleared_numbers_must_be_absent_not_unparseable() {
    let mut actual = Tag::new(TagType::Id3v2);
    actual.insert_text(ItemKey::TrackNumber, "invalid".into());
    let changes = [MetadataChange {
        values: Vec::new(),
        field: MetadataField::TrackNumber,
        value: None,
    }];
    assert!(verify_changes(&actual, &changes).is_err());
    actual.remove_key(ItemKey::TrackNumber);
    assert!(verify_changes(&actual, &changes).is_ok());
}

#[test]
fn rejects_nonempty_loss_value_changes_and_lost_duplicate_occurrences() {
    let mut expected = Tag::new(TagType::VorbisComments);
    let artist = TagItem::new(ItemKey::TrackArtist, ItemValue::Text("Guest".into()));
    expected.push(artist.clone());
    expected.push(artist.clone());
    let mut actual = expected.clone();
    assert!(verify_tag_items(&expected, &actual).is_ok());
    actual.insert(artist);
    assert!(verify_tag_items(&expected, &actual)
        .unwrap_err()
        .contains("TrackArtist"));
    actual.insert_text(ItemKey::TrackArtist, "Someone else".into());
    assert!(verify_tag_items(&expected, &actual).is_err());
    actual.remove_key(ItemKey::TrackArtist);
    assert!(verify_tag_items(&expected, &actual).is_err());
}
