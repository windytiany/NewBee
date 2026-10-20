pub(crate) mod commands;
mod confirmation;
pub(crate) mod discovery;
mod inspection;
pub(crate) mod model;
mod recovery;
mod refresh;

pub(crate) use confirmation::{schedule, ConfirmationState};
pub(crate) use discovery::has_supported_extension;
pub(crate) use inspection::{inspect, inspect_with_directory};
pub(crate) use recovery::resume;
pub(crate) use refresh::reread;

use crate::database::Database;
use model::TrackRegistrationResult;

pub(crate) fn register(
    database: &Database,
    paths: &[String],
) -> Result<Vec<TrackRegistrationResult>, String> {
    database.register_tracks(discovery::discover(paths))
}

#[cfg(test)]
mod tests;
