use super::support::{change, Fixture};
use crate::{
    artwork::track::{
        commands,
        editing::{PictureDraft, TrackDraft},
    },
    database::Database,
    locking::WriteState,
    metadata::{
        files,
        model::{LyricsMarkAction, MetadataField, MetadataSaveRequest},
        save_track_metadata,
    },
};
use serde_json::json;
use std::fs;
use support::{app, draft, image, save};
use tauri::Manager;

mod failures;
mod support;
