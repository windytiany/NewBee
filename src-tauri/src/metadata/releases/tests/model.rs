use super::*;

#[test]
fn selected_release_and_track_supply_sorting_dates_label_and_distinct_identifiers() {
    let release_id = "76df3287-6cda-33eb-8e9a-044b5e15ffdd";
    let recording_id = "89ad4ac3-39f7-470e-963a-56509c546377";
    let track_id = "278274bd-829e-4c95-8a54-329932d6c28f";
    let credit = serde_json::json!({"name":"Artist credit", "artist":{"id":release_id,"name":"Canonical", "sort-name":"Canonical, The"}});
    let raw: RawRelease = serde_json::from_value(serde_json::json!({
        "id":release_id,"title":"Selected release","date":"2024-02-29",
        "artist-credit":[credit.clone()],
        "release-group":{"id":recording_id,"title":"Group title","first-release-date":"1998-03"},
        "label-info":[{"label":{"name":"Label A"}},{"label":null},{"label":{"name":"Label B"}}],
        "media":[{"position":1,"title":"Bonus disc","track-count":1,"tracks":[{
            "id":track_id,"position":1,"title":"Selected track title","artist-credit":[credit],
            "recording":{"id":recording_id,"title":"Different recording title"}
        }]}]
    }))
    .unwrap();
    let details = raw.details().unwrap();
    assert_eq!(details.summary.title, "Selected release");
    assert_eq!(details.summary.artist.as_deref(), Some("Artist credit"));
    assert_eq!(details.summary.release_date.as_deref(), Some("2024-02-29"));
    assert_eq!(
        details.values[&MetadataField::OriginalReleaseDate],
        "1998-03"
    );
    assert_eq!(
        details.values[&MetadataField::AlbumArtistSort],
        "Canonical, The"
    );
    assert_eq!(details.values[&MetadataField::Label], "Label A; Label B");
    assert_eq!(
        details.identifiers[&MetadataField::MusicBrainzReleaseId],
        [release_id]
    );
    assert_eq!(
        details.identifiers[&MetadataField::MusicBrainzReleaseGroupId],
        [recording_id]
    );
    assert_eq!(
        details.identifiers[&MetadataField::MusicBrainzAlbumArtistId],
        [release_id]
    );
    let track = &details.tracks[0];
    assert_eq!(track.title, "Selected track title");
    assert_eq!(track.artist.as_deref(), Some("Artist credit"));
    assert_eq!(track.values[&MetadataField::ArtistSort], "Canonical, The");
    assert_eq!(track.values[&MetadataField::DiscSubtitle], "Bonus disc");
    assert_eq!(
        track.identifiers[&MetadataField::MusicBrainzTrackId],
        [track_id]
    );
    assert_eq!(
        track.identifiers[&MetadataField::MusicBrainzRecordingId],
        [recording_id]
    );
    assert_eq!(
        track.identifiers[&MetadataField::MusicBrainzArtistId],
        [release_id]
    );
}
#[test]
fn accepts_numeric_and_text_cover_ids() {
    let covers: RawCovers = serde_json::from_str(r#"{"images":[{"id":829521842,"front":true},{"id":"829521843","front":false,"types":["Front"]}]}"#).unwrap();
    assert_eq!(covers.images[0].id, "829521842");
    assert_eq!(covers.images[1].id, "829521843");
}

#[test]
fn preserves_release_track_credits_and_per_disc_totals() {
    let raw: RawRelease = serde_json::from_str(r#"{"id":"id","title":"再版","date":"2016","artist-credit":[{"name":"A","joinphrase":" & "},{"name":"B"}],"media":[{"position":2,"track-count":1,"tracks":[{"title":"曲目署名","position":1,"length":1234,"artist-credit":[{"name":"Guest"}]}]},{"position":1,"track-count":2,"tracks":[{"title":"第一首","position":1}]}]}"#).unwrap();
    let details = raw.details().unwrap();
    assert_eq!(details.summary.artist.as_deref(), Some("A & B"));
    assert_eq!(details.summary.release_date.as_deref(), Some("2016"));
    assert_eq!(details.tracks[0].track_total, 2);
    assert_eq!(details.tracks[1].artist.as_deref(), Some("Guest"));
    assert_eq!(details.tracks[1].disc_number, 2);
}
