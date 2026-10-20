use super::support::{change, Fixture};
use crate::{
    artwork::{
        model::ArtworkContent,
        track::{
            commands,
            editing::{self, PictureDraft, TrackDraft},
        },
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

mod embedded;
mod failures;
mod ipc;
mod linked;
mod support;
