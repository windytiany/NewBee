pub(crate) mod commands;
mod measurement;

use crate::metadata::files::replaygain::{self, TrackGain};
use std::{fs, path::Path};

const TARGET_LUFS: f64 = -18.0;

pub(crate) fn generate(path: &Path, overwrite: bool) -> Result<bool, String> {
    if !overwrite && replaygain::read(path)?.complete() {
        return Ok(false);
    }
    let before = fs::metadata(path).map_err(|error| error.to_string())?;
    if before.permissions().readonly() {
        return Err("文件为只读".to_owned());
    }
    let measurement::Measurement { loudness, peak } = measurement::measure(path)?;
    let gain_db = if loudness.is_finite() {
        TARGET_LUFS - loudness
    } else if loudness == f64::NEG_INFINITY {
        // No gated blocks: silence, below-gate audio and sub-block clips have
        // no integrated loudness. Keep their level rather than amplifying noise.
        0.0
    } else {
        return Err("响度测量结果无效".to_owned());
    };
    let after = fs::metadata(path).map_err(|error| error.to_string())?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("文件已变化，请重新分析响度".to_owned());
    }
    replaygain::write(
        path,
        TrackGain {
            gain_db: Some(gain_db),
            peak: Some(peak),
        },
        overwrite,
    )
}

#[cfg(test)]
mod tests;
