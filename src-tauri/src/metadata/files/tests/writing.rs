use crate::metadata::{
    files,
    model::MetadataField,
    tests::support::{change, Fixture},
};
use lofty::{
    config::WriteOptions,
    file::TaggedFileExt,
    prelude::*,
    tag::{Tag, TagType},
};
use std::fs;

#[test]
fn failed_round_trip_discards_the_copy_and_keeps_original_bytes() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let before = fs::read(&path).unwrap();
    // Inject a value the ID3 serializer reads back as multiple values. Command
    // validation rejects NULs; this exercises the final transactional safeguard.
    let error = files::write_file(
        &path,
        &[change(MetadataField::Title, Some("first\0second"))],
    )
    .unwrap_err();
    assert!(error.contains("字段 Title 写入后回读不一致"), "{error}");
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
}

#[test]
fn failed_validation_never_changes_file() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let mut tag = Tag::new(TagType::Id3v2);
    tag.set_track_total(2);
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    let before = fs::read(&path).unwrap();
    assert!(files::write_file(&path, &[change(MetadataField::TrackNumber, Some("3"))]).is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn read_only_files_are_not_modified() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let original_permissions = fs::metadata(&path).unwrap().permissions();
    let mut read_only = original_permissions.clone();
    read_only.set_readonly(true);
    fs::set_permissions(&path, read_only).unwrap();
    let inspect = files::inspect_file(&path);
    let write = files::write_file(&path, &[change(MetadataField::Title, Some("new"))]);
    fs::set_permissions(&path, original_permissions).unwrap();
    let inspected = inspect.unwrap();
    assert!(inspected.writable_fields.is_empty());
    assert_eq!(inspected.issue.as_deref(), Some("文件为只读"));
    assert!(write.is_err());
    assert!(lofty::read_from_path(&path)
        .unwrap()
        .primary_tag()
        .is_none());
}
