pub(crate) mod commands;
pub(crate) mod discovery;
pub(crate) mod model;

#[cfg(test)]
mod tests {
    use crate::database::{tests::support::insert_track, Database};
    use serde_json::{json, Value};
    use tauri::Manager;

    #[test]
    fn one_batch_command_appends_5000_independent_items_in_input_order() {
        let database = Database::open(":memory:").unwrap();
        let playlist = database.create_playlist("Batch").unwrap();
        insert_track(&database, 1, None, None, 1, None);
        insert_track(&database, 2, None, None, 2, None);
        let app = tauri::test::mock_builder()
            .manage(database)
            .invoke_handler(tauri::generate_handler![
                super::commands::append_playlist_tracks
            ])
            .build(tauri::generate_context!())
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let track_ids: Vec<i64> = (0..5000).map(|index| index % 2 + 1).collect();
        let start = std::time::Instant::now();
        let results: Value = tauri::test::get_ipc_response(
            &window,
            tauri::webview::InvokeRequest {
                cmd: "append_playlist_tracks".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(
                    json!({"playlistId": playlist, "trackIds": track_ids}),
                ),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
        .unwrap()
        .deserialize()
        .unwrap();
        let items = app
            .state::<Database>()
            .list_playlist_tracks(playlist)
            .unwrap();
        assert_eq!(results.as_array().unwrap().len(), 5000);
        assert_eq!(items.len(), 5000);
        assert_eq!(
            items.iter().map(|item| item.track_id).collect::<Vec<_>>(),
            track_ids
        );
        assert_eq!(
            items
                .iter()
                .map(|item| item.playlist_item_id)
                .collect::<std::collections::HashSet<_>>()
                .len(),
            5000
        );
        for (index, item) in items.iter().enumerate() {
            assert_eq!(
                results[index],
                json!({"index": index, "trackId": item.track_id, "status": "added", "playlistItemId": item.playlist_item_id})
            );
        }
        println!(
            "playlist append: 5000 items, 1 IPC, elapsed {:?}",
            start.elapsed()
        );
    }
}
