use super::*;

pub(super) fn title(value: &str) -> MetadataChange {
    MetadataChange {
        field: MetadataField::Title,
        value: Some(value.into()),
        values: Vec::new(),
    }
}
pub(super) fn id(database: &Database, path: &str) -> i64 {
    database
        .connection()
        .unwrap()
        .query_row("SELECT id FROM tracks WHERE path = ?1", [path], |row| {
            row.get(0)
        })
        .unwrap()
}
pub(super) fn canonical(path: String) -> String {
    Path::new(&path)
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .into_owned()
}
