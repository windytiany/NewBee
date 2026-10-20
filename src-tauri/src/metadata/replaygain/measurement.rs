use ebur128::{Channel, EbuR128, Mode};
use lofty::{
    config::ParseOptions,
    file::{AudioFile, FileType, TaggedFileExt},
    probe::Probe,
    properties::ChannelMask,
};
use rodio::{Decoder, Source};
use std::{fs::File, path::Path};

pub(super) struct Measurement {
    pub(super) loudness: f64,
    pub(super) peak: f64,
}

pub(super) fn measure(path: &Path) -> Result<Measurement, String> {
    let mut decoder = Decoder::try_from(File::open(path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("音频解码失败：{error}"))?;
    let channels = u32::from(decoder.channels().get());
    let rate = decoder.sample_rate().get();
    let mut analyzer = EbuR128::new(channels, rate, Mode::I | Mode::TRUE_PEAK | Mode::HISTOGRAM)
        .map_err(|error| format!("无法初始化响度分析：{error}"))?;
    configure_channels(&mut analyzer, path, channels)?;
    let samples_per_block = (rate as usize / 100).max(1) * channels as usize;
    let mut buffer = Vec::with_capacity(samples_per_block);
    loop {
        buffer.clear();
        buffer.extend(decoder.by_ref().take(samples_per_block));
        if buffer.is_empty() {
            break;
        }
        if buffer.iter().any(|sample| !sample.is_finite()) {
            return Err("音频包含无效采样".to_owned());
        }
        analyzer
            .add_frames_f32(&buffer)
            .map_err(|error| error.to_string())?;
    }
    drop(decoder);
    let peak = (0..channels)
        .map(|channel| analyzer.true_peak(channel))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?
        .into_iter()
        .fold(0.0_f64, f64::max);
    let loudness = analyzer
        .loudness_global()
        .map_err(|error| error.to_string())?;
    Ok(Measurement { loudness, peak })
}

fn configure_channels(analyzer: &mut EbuR128, path: &Path, channels: u32) -> Result<(), String> {
    if channels <= 2 {
        return Ok(());
    }
    let file = Probe::open(path)
        .map_err(|error| error.to_string())?
        .guess_file_type()
        .map_err(|error| error.to_string())?
        .options(ParseOptions::default().read_tags(false))
        .read()
        .map_err(|error| error.to_string())?;
    let mask = file
        .properties()
        .channel_mask()
        .or_else(|| {
            matches!(file.file_type(), FileType::Flac | FileType::Vorbis)
                .then(|| {
                    u8::try_from(channels)
                        .ok()
                        .and_then(ChannelMask::from_opus_channels)
                })
                .flatten()
        })
        .ok_or("无法识别音频声道布局")?
        .bits();
    if mask.count_ones() != channels || mask >> 11 != 0 {
        return Err("不支持此音频的声道布局".to_owned());
    }
    let mut index = 0;
    for bit in 0..11 {
        if mask & (1 << bit) == 0 {
            continue;
        }
        let channel = match bit {
            0 | 6 => Channel::Left,
            1 | 7 => Channel::Right,
            2 => Channel::Center,
            3 => Channel::Unused,
            4 | 8 | 9 => Channel::LeftSurround,
            _ => Channel::RightSurround,
        };
        analyzer
            .set_channel(index, channel)
            .map_err(|error| error.to_string())?;
        index += 1;
    }
    Ok(())
}
