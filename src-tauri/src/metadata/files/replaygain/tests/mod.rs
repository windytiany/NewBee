mod gain;
mod removal;
mod writing;

use super::*;
use lofty::{config::WriteOptions, prelude::TagExt};
use std::fs::File;

fn measured() -> TrackGain {
    TrackGain {
        gain_db: Some(-6.0),
        peak: Some(0.8),
    }
}
