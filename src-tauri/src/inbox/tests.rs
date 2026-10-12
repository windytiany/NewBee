use super::*;
use crate::{
    library::import::tests::support::TestFiles,
    metadata::files,
    metadata::model::{MetadataChange, MetadataField},
};

fn title(value: &str) -> MetadataChange {
    MetadataChange {
        field: MetadataField::Title,
        value: Some(value.into()),
        values: Vec::new(),
    }
}

#[test]
fn paths_coexist_with_snapshots_and_only_scanning_updates_the_library() {
    let files = TestFiles::new();
    let path = std::fs::canonicalize(files.wav("track.wav"))
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let database = Database::open(":memory:").unwrap();
    assert!(register(&database, vec![path.clone()])[0].success);
    assert!(database
        .list_artists(crate::library::model::LibraryGrouping::Artist)
        .unwrap()
        .is_empty());
    crate::library::import::import_track(&database, Path::new(&path), &mut Default::default());
    let id: i64 = database
        .connection()
        .unwrap()
        .query_row("SELECT id FROM tracks WHERE path=?1", [&path], |row| {
            row.get(0)
        })
        .unwrap();
    assert!(register(&database, vec![path.clone(), path.clone()])
        .iter()
        .all(|result| result.success));
    assert_eq!(database.inbox_paths().unwrap(), std::slice::from_ref(&path));
    files::write_file(Path::new(&path), &[title("Edited")]).unwrap();
    assert_eq!(
        files::read_track(Path::new(&path))
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("Edited")
    );
    assert_eq!(database.get_track(id).unwrap().unwrap().title, None);
    assert_eq!(
        refresh(&database).unwrap().tracks[0]
            .snapshot
            .title
            .as_deref(),
        Some("Edited")
    );
    crate::library::import::import_track(&database, Path::new(&path), &mut Default::default());
    assert_eq!(
        database.get_track(id).unwrap().unwrap().title.as_deref(),
        Some("Edited")
    );
    assert_eq!(database.inbox_paths().unwrap(), std::slice::from_ref(&path));
    files::write_file(Path::new(&path), &[title("Final")]).unwrap();
    assert!(ingest(&database, vec![path.clone()])[0].success);
    assert_eq!(
        database.get_track(id).unwrap().unwrap().title.as_deref(),
        Some("Final")
    );
    assert!(database.inbox_paths().unwrap().is_empty());
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn partial_ingest_preserves_failures_and_refresh_removes_unreadable_registrations() {
    let files = TestFiles::new();
    let good = std::fs::canonicalize(files.wav("good.wav"))
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let missing = std::fs::canonicalize(files.wav("missing.wav"))
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let database = Database::open(":memory:").unwrap();
    register(&database, vec![good.clone(), missing.clone()]);
    std::fs::remove_file(&missing).unwrap();
    let results = ingest(&database, vec![good.clone(), missing.clone()]);
    assert!(results[0].success);
    assert!(!results[1].success);
    assert_eq!(
        database.inbox_paths().unwrap(),
        std::slice::from_ref(&missing)
    );
    let read = refresh(&database).unwrap();
    assert!(read.tracks.is_empty());
    assert_eq!(read.failures.len(), 1);
    assert!(database.inbox_paths().unwrap().is_empty());
    assert!(Path::new(&good).exists());
    assert!(!register(&database, vec![missing])[0].success);
    assert!(database.inbox_paths().unwrap().is_empty());
}

#[test]
fn persists_paths_without_tags_and_removal_does_not_change_files() {
    let files = TestFiles::new();
    let path = std::fs::canonicalize(files.wav("track.wav"))
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let db_path = files.0.join("inbox.sqlite3");
    {
        let database = Database::open(&db_path).unwrap();
        register(&database, vec![path.clone()]);
    }
    let database = Database::open(&db_path).unwrap();
    assert_eq!(database.inbox_paths().unwrap(), std::slice::from_ref(&path));
    files::write_file(Path::new(&path), &[title("External")]).unwrap();
    assert_eq!(
        refresh(&database).unwrap().tracks[0]
            .snapshot
            .title
            .as_deref(),
        Some("External")
    );
    database.remove_inbox_path(&path).unwrap();
    assert!(database.inbox_paths().unwrap().is_empty());
    assert_eq!(
        files::read_track(Path::new(&path))
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("External")
    );
}

#[test]
fn refresh_cannot_unregister_a_file_while_application_writes_are_in_progress() {
    let files = TestFiles::new();
    let path = std::fs::canonicalize(files.wav("track.wav"))
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let bytes = std::fs::read(&path).unwrap();
    let app = tauri::test::mock_builder()
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .build(tauri::generate_context!())
        .unwrap();
    register(&app.state::<Database>(), vec![path.clone()]);
    crate::metadata::files::access::take(&files.0);
    let guard = app.state::<WriteState>().acquire().unwrap();
    std::fs::write(&path, b"temporarily unreadable during a write").unwrap();
    let result = tauri::async_runtime::block_on(read_inbox(app.handle().clone(), app.state()));
    assert!(result.is_err());
    assert_eq!(
        app.state::<Database>().inbox_paths().unwrap(),
        std::slice::from_ref(&path)
    );
    assert!(crate::metadata::files::access::take(&files.0)
        .iter()
        .all(|(_, kind)| *kind != "parse"));
    std::fs::write(&path, bytes).unwrap();
    drop(guard);
    let read =
        tauri::async_runtime::block_on(read_inbox(app.handle().clone(), app.state())).unwrap();
    assert_eq!(read.tracks.len(), 1);
    assert!(read.failures.is_empty());
    assert_eq!(
        app.state::<Database>().inbox_paths().unwrap(),
        std::slice::from_ref(&path)
    );
    std::fs::write(&path, b"permanently unreadable").unwrap();
    let read =
        tauri::async_runtime::block_on(read_inbox(app.handle().clone(), app.state())).unwrap();
    assert_eq!(read.failures.len(), 1);
    assert!(app.state::<Database>().inbox_paths().unwrap().is_empty());
}

#[test]
fn recursive_registration_keeps_successes_and_skips_only_inbox_duplicates() {
    let files = TestFiles::new();
    std::fs::create_dir(files.0.join("nested")).unwrap();
    let one = files.wav("one.wav");
    let two = files.wav("nested/two.wav");
    files.write("ignore.txt", b"not audio");
    let database = Database::open(":memory:").unwrap();
    let results = register_directories(
        &database,
        vec![
            files.0.join("missing").to_string_lossy().into_owned(),
            files.0.to_string_lossy().into_owned(),
        ],
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| result.success && !result.skipped)
            .count(),
        2
    );
    assert_eq!(results.iter().filter(|result| !result.success).count(), 1);
    assert_eq!(database.inbox_paths().unwrap().len(), 2);
    let duplicates = register(&database, vec![one.clone(), one, two]);
    assert!(duplicates
        .iter()
        .all(|result| result.success && result.skipped));
    assert_eq!(database.inbox_paths().unwrap().len(), 2);
}
