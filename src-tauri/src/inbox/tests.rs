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
fn registration_revokes_membership_and_only_ingesting_updates_the_snapshot() {
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
    assert!(database.library_track_paths().unwrap().is_empty());
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
            .file
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
    assert!(database.inbox_paths().unwrap().is_empty());
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
fn partial_registration_transfers_only_successful_paths() {
    let files = TestFiles::new();
    let paths: Vec<String> = ["good.wav", "blocked.wav"]
        .into_iter()
        .map(|name| {
            std::fs::canonicalize(files.wav(name))
                .unwrap()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    let contents: Vec<_> = paths
        .iter()
        .map(|path| std::fs::read(path).unwrap())
        .collect();
    let database = Database::open(":memory:").unwrap();
    for path in &paths {
        crate::library::import::import_track(&database, Path::new(path), &mut Default::default());
    }
    database.connection().unwrap().execute_batch(
        "CREATE TRIGGER reject_membership_removal BEFORE UPDATE OF in_library ON tracks WHEN NEW.in_library = 0 AND OLD.path LIKE '%blocked.wav' BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
    ).unwrap();

    let results = register(&database, paths.clone());
    assert!(results[0].success);
    assert!(!results[0].skipped);
    assert!(!results[1].success);
    assert!(results[1].error.as_deref().unwrap().contains("blocked"));
    assert_eq!(database.inbox_paths().unwrap(), vec![paths[0].clone()]);
    assert_eq!(
        database.library_track_paths().unwrap(),
        vec![paths[1].clone()]
    );
    for (path, content) in paths.iter().zip(contents) {
        assert_eq!(std::fs::read(path).unwrap(), content);
    }
}

#[test]
fn partial_ingest_and_refresh_preserve_unreadable_registrations() {
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
    assert_eq!(read.tracks.len(), 1);
    assert_eq!(read.tracks[0].file.snapshot.path, missing);
    assert_eq!(read.failures.len(), 1);
    assert_eq!(
        database.inbox_paths().unwrap(),
        std::slice::from_ref(&missing)
    );
    assert!(Path::new(&good).exists());
    assert!(!register(&database, vec![missing.clone()])[0].success);
    assert_eq!(database.inbox_paths().unwrap(), [missing]);
}

#[test]
fn persists_paths_without_tags_and_removal_does_not_change_files() {
    let files = TestFiles::new();
    let path = std::fs::canonicalize(files.wav("track.wav"))
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let db_path = files.0.join("inbox.sqlite3");
    let added_at;
    {
        let database = Database::open(&db_path).unwrap();
        register(&database, vec![path.clone()]);
        assert!(refresh(&database).unwrap().tracks[0].added_at > 0);
        database
            .connection()
            .unwrap()
            .execute("UPDATE inbox SET added_at = 123", [])
            .unwrap();
        added_at = refresh(&database).unwrap().tracks[0].added_at;
        let serialized = serde_json::to_value(refresh(&database).unwrap()).unwrap();
        assert_eq!(serialized["tracks"][0]["addedAt"], added_at);
        assert_eq!(serialized["tracks"][0]["path"], path);
    }
    let database = Database::open(&db_path).unwrap();
    assert_eq!(database.inbox_paths().unwrap(), std::slice::from_ref(&path));
    assert_eq!(refresh(&database).unwrap().tracks[0].added_at, added_at);
    assert!(register(&database, vec![path.clone()])[0].skipped);
    assert_eq!(refresh(&database).unwrap().tracks[0].added_at, added_at);
    files::write_file(Path::new(&path), &[title("External")]).unwrap();
    assert_eq!(
        refresh(&database).unwrap().tracks[0]
            .file
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
    assert!(register(&database, vec![path])[0].success);
    assert!(refresh(&database).unwrap().tracks[0].added_at > added_at);
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
    assert_eq!(read.tracks.len(), 1);
    assert_eq!(read.tracks[0].file.snapshot.path, path);
    assert_eq!(app.state::<Database>().inbox_paths().unwrap(), [path]);
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

#[test]
fn inbox_accepts_broken_tags_and_keeps_an_audition_target_with_failure_feedback() {
    let files = TestFiles::new();
    let path = files.write("broken.flac", b"broken tags and audio");
    let database = Database::open(":memory:").unwrap();
    assert!(register(&database, vec![path.clone()])[0].success);
    let canonical = Path::new(&path)
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let read = refresh(&database).unwrap();
    assert_eq!(read.tracks.len(), 1);
    assert_eq!(read.tracks[0].file.snapshot.path, canonical);
    assert_eq!(read.failures.len(), 1);
    assert!(read.failures[0]
        .error
        .as_ref()
        .is_some_and(|error| !error.is_empty()));
    assert_eq!(database.inbox_paths().unwrap(), [canonical]);
    assert!(database.library_track_paths().unwrap().is_empty());
}
