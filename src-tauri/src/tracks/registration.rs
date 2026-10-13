use super::{discovery, model::TrackRegistrationResult};
use crate::database::Database;

pub(crate) fn register(
    database: &Database,
    paths: &[String],
) -> Result<Vec<TrackRegistrationResult>, String> {
    database.register_tracks(discovery::discover(paths))
}

#[cfg(test)]
#[path = "registration/tests.rs"]
mod tests;
