use super::*;
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
