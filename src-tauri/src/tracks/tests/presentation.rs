use super::*;
use crate::database::tracks::confirmation::Confirmation;

#[test]
fn presentation_waits_for_confirmation_before_using_metadata_or_fallbacks() {
    for outcome in ["metadata", "missing", "failed"] {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("filename.flac");
        std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
        if outcome == "metadata" {
            files::write_file(
                &path,
                &[
                    change(MetadataField::Title, "Metadata title"),
                    change(MetadataField::Album, "Metadata album"),
                ],
            )
            .unwrap();
        }
        let database = Database::open(":memory:").unwrap();
        let registered =
            super::super::registration::register(&database, &[path.to_string_lossy().into_owned()])
                .unwrap();
        let super::super::model::TrackRegistrationResult::Registered { track, .. } = &registered[0]
        else {
            panic!("registration failed");
        };
        let id = track.id;
        let app = tauri::test::mock_builder()
            .manage(database)
            .invoke_handler(tauri::generate_handler![
                super::super::commands::get_track_presentation
            ])
            .build(tauri::generate_context!())
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let presentation = || {
            invoke(&window, "get_track_presentation", json!({"trackId": id}))
                .deserialize::<Value>()
                .unwrap()
        };
        assert_eq!(presentation(), Value::Null);
        let database = window.state::<Database>();
        let (path, revision) = database.pending_track(id).unwrap().unwrap();
        let snapshot = if outcome == "failed" {
            Err("Scan failed".into())
        } else {
            super::super::scanning::scan(&database, Path::new(&path))
        };
        let duration = snapshot
            .as_ref()
            .ok()
            .and_then(|snapshot| snapshot.track.duration_ms);
        let results = database
            .confirm_tracks(vec![Confirmation {
                id,
                revision,
                path,
                snapshot,
            }])
            .unwrap();
        assert!(results[0].database_updated);
        assert_eq!(results[0].error.is_some(), outcome == "failed");
        let confirmed = presentation();
        assert_eq!(
            confirmed["title"],
            if outcome == "metadata" {
                "Metadata title"
            } else {
                "filename"
            }
        );
        assert_eq!(
            confirmed["album"],
            if outcome == "metadata" {
                json!("Metadata album")
            } else {
                Value::Null
            }
        );
        assert_eq!(confirmed["durationMs"], json!(duration));
        if outcome == "failed" {
            assert!(duration.is_none());
        } else {
            assert!(duration.is_some_and(|duration| duration > 0));
        }
    }
}
