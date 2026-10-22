use super::*;
use crate::{
    fixtures::TestFiles,
    metadata::{
        model::{LyricsMarkAction, MetadataChange, MetadataField, MetadataSaveRequest},
        save_track_metadata,
    },
};

struct Cleanup(&'static str);
impl Drop for Cleanup {
    fn drop(&mut self) {
        release_task(self.0.into()).unwrap();
    }
}

#[test]
fn reservations_cover_whole_batches_and_cancellation_stops_between_committed_tracks() {
    let files = TestFiles::new();
    let database = Database::open(":memory:").unwrap();
    for name in ["first.wav", "second.wav"] {
        let path = files.wav(name);
        let snapshot = crate::tracks::inspect(&database, std::path::Path::new(&path)).unwrap();
        database.import_snapshot(&snapshot).unwrap();
    }
    let app = tauri::test::mock_builder()
        .manage(database)
        .manage(WriteState::default())
        .manage(crate::tracks::ConfirmationState::default())
        .build(tauri::generate_context!())
        .unwrap();
    let id = "native-cancellation-test";
    let _cleanup = Cleanup(id);
    let reserve = tauri::async_runtime::block_on(reserve_task(
        app.handle().clone(),
        id.into(),
        id.into(),
        vec![1, 2],
        vec![],
        vec![],
    ))
    .unwrap();
    assert!(reserve.is_none());
    assert!(restoring().is_err());
    assert!(app
        .state::<WriteState>()
        .acquire_registered(Some(id))
        .is_err());
    assert!(occupied_tracks(app.handle().clone(), vec![1]).unwrap());
    assert!(tauri::async_runtime::block_on(reserve_task(
        app.handle().clone(),
        "conflict".into(),
        "conflict".into(),
        vec![2],
        vec![],
        vec![]
    ))
    .is_err());
    tauri::async_runtime::block_on(start_task(app.handle().clone(), id.into())).unwrap();
    let progress = tauri::ipc::Channel::new(move |_| {
        cancel_task(id.into()).unwrap();
        Ok(())
    });
    let results = tauri::async_runtime::block_on(save_track_metadata(
        MetadataSaveRequest {
            track_ids: vec![1, 2],
            changes: vec![MetadataChange {
                field: MetadataField::Title,
                value: Some("Committed".into()),
                values: vec![],
            }],
            lyrics_action: LyricsMarkAction::Keep,
            artwork_drafts: vec![],
        },
        progress,
        Some(id.into()),
        app.handle().clone(),
        app.state::<WriteState>(),
    ))
    .unwrap();
    assert_eq!(results.len(), 1);
    assert!(results[0].database_updated, "{:?}", results[0].error);
    let database = app.state::<Database>();
    assert_eq!(
        database.get_track(1).unwrap().unwrap().title.as_deref(),
        Some("Committed")
    );
    assert_ne!(
        database.get_track(2).unwrap().unwrap().title.as_deref(),
        Some("Committed")
    );
    assert!(app.state::<WriteState>().acquire().is_ok());
    release_task(id.into()).unwrap();
    assert!(!occupied_tracks(app.handle().clone(), vec![1, 2]).unwrap());
    let queued = "native-queued-cancellation";
    let _queued_cleanup = Cleanup(queued);
    tauri::async_runtime::block_on(reserve_task(
        app.handle().clone(),
        queued.into(),
        queued.into(),
        vec![1],
        vec![],
        vec![],
    ))
    .unwrap();
    cancel_task(queued.into()).unwrap();
    assert!(
        tauri::async_runtime::block_on(start_task(app.handle().clone(), queued.into())).is_err()
    );
    release_task(queued.into()).unwrap();
    let restore = restoring().unwrap();
    assert!(pending());
    drop(restore);
    assert!(!pending());

    let registration_id = "native-folder-registration";
    let _registration_cleanup = Cleanup(registration_id);
    tauri::async_runtime::block_on(reserve_task(
        app.handle().clone(),
        registration_id.into(),
        registration_id.into(),
        vec![],
        vec![files.0.to_string_lossy().into_owned()],
        vec![],
    ))
    .unwrap();
    tauri::async_runtime::block_on(start_task(app.handle().clone(), registration_id.into()))
        .unwrap();
    // A writer may acquire the gate between starting the task and invoking its command.
    let guard = app.state::<WriteState>().acquire().unwrap();
    let mut registration = Box::pin(crate::tracks::commands::register_local_tracks(
        vec![files.0.to_string_lossy().into_owned()],
        Some(registration_id.into()),
        app.handle().clone(),
    ));
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    assert!(std::future::Future::poll(registration.as_mut(), &mut context).is_pending());
    drop(guard);
    let registered = tauri::async_runtime::block_on(registration).unwrap();
    assert_eq!(registered.len(), 2);
    assert!(registered.iter().all(|result| matches!(
        result,
        crate::tracks::model::TrackRegistrationResult::Registered { .. }
    )));
    cancel_task(registration_id.into()).unwrap();
    assert!(
        tauri::async_runtime::block_on(crate::tracks::commands::register_local_tracks(
            vec![files.0.to_string_lossy().into_owned()],
            Some(registration_id.into()),
            app.handle().clone(),
        ))
        .is_err()
    );
}
