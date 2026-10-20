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
    } else if peak == 0.0 {
        0.0
    } else {
        return Err("音频过短或低于响度测量门限".to_owned());
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
