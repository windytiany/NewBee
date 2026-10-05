use super::*;
use rodio::buffer::SamplesBuffer;
use std::num::{NonZeroU16, NonZeroU32};

fn tone(frequency: f32, amplitude: f32, sample_rate: u32, frames: usize) -> Vec<f32> {
    (0..frames)
        .map(|frame| (2.0 * PI * frequency * frame as f32 / sample_rate as f32).sin() * amplitude)
        .collect()
}

fn capture(samples: Vec<f32>, channels: u16, sample_rate: u32) -> [f32; BAND_COUNT] {
    let source = SamplesBuffer::new(
        NonZeroU16::new(channels).unwrap(),
        NonZeroU32::new(sample_rate).unwrap(),
        samples,
    );
    let (mut source, capture) = SpectrumSource::new(source);
    while source.next().is_some() {}
    capture.bands()
}

#[test]
fn silence_and_dc_have_no_spectrum() {
    assert_eq!(capture(vec![0.0; FFT_SIZE], 1, 48000), [0.0; BAND_COUNT]);
    assert_eq!(capture(vec![0.5; FFT_SIZE], 1, 48000), [0.0; BAND_COUNT]);
}

#[test]
fn tones_peak_in_their_logarithmic_bands_at_different_sample_rates() {
    for rate in [44100, 48000, 96000] {
        for (band, frequency) in [60.0, 120.0, 240.0, 480.0, 960.0, 1920.0, 3840.0, 7680.0]
            .into_iter()
            .enumerate()
        {
            let bands = capture(tone(frequency, 0.5, rate, FFT_SIZE), 1, rate);
            let peak = bands
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.total_cmp(b.1))
                .unwrap()
                .0;
            assert_eq!(
                peak, band,
                "frequency {frequency}, sample rate {rate}: {bands:?}"
            );
            assert!(bands[band] > 0.8);
        }
    }
}

#[test]
fn reduced_volume_reduces_spectral_levels_and_mute_is_silent() {
    let loud = capture(tone(960.0, 0.5, 48000, FFT_SIZE), 1, 48000);
    let quiet = capture(tone(960.0, 0.05, 48000, FFT_SIZE), 1, 48000);
    assert!(loud[4] - quiet[4] > 0.3);
    assert_eq!(
        capture(tone(960.0, 0.0, 48000, FFT_SIZE), 1, 48000),
        [0.0; BAND_COUNT]
    );
}

#[test]
fn stereo_phase_cancellation_does_not_hide_the_spectrum() {
    let mono = tone(960.0, 0.5, 48000, FFT_SIZE);
    let stereo = mono.iter().flat_map(|sample| [*sample, -*sample]).collect();
    let mono_bands = capture(mono, 1, 48000);
    let stereo_bands = capture(stereo, 2, 48000);
    for (mono, stereo) in mono_bands.iter().zip(stereo_bands) {
        assert!((mono - stereo).abs() < 0.001);
    }
}

#[test]
fn ring_wrap_keeps_only_the_latest_audio() {
    let mut samples = tone(120.0, 0.5, 48000, CAPTURE_FRAMES * 2);
    samples.extend(tone(3840.0, 0.5, 48000, FFT_SIZE));
    let bands = capture(samples, 1, 48000);
    assert!(bands[6] > 0.8);
    assert!(bands[1] < 0.1);
}

#[test]
fn source_is_transparent_and_reset_drops_pre_seek_audio() {
    let samples = tone(960.0, 0.5, 48000, FFT_SIZE);
    let inner = SamplesBuffer::new(
        NonZeroU16::new(1).unwrap(),
        NonZeroU32::new(48000).unwrap(),
        samples.clone(),
    );
    let duration = inner.total_duration();
    let (mut source, capture) = SpectrumSource::new(inner);
    assert_eq!(source.channels().get(), 1);
    assert_eq!(source.sample_rate().get(), 48000);
    assert_eq!(source.total_duration(), duration);
    assert_eq!(source.by_ref().collect::<Vec<_>>(), samples);
    assert!(capture.bands()[4] > 0.8);
    capture.reset();
    assert_eq!(capture.bands(), [0.0; BAND_COUNT]);
}

#[test]
fn incomplete_frames_and_non_finite_samples_are_safe() {
    let inner = SamplesBuffer::new(
        NonZeroU16::new(2).unwrap(),
        NonZeroU32::new(48000).unwrap(),
        vec![f32::NAN, f32::INFINITY, 1.0],
    );
    let (mut source, capture) = SpectrumSource::new(inner);
    assert!(source.next().unwrap().is_nan());
    assert_eq!(capture.bands(), [0.0; BAND_COUNT]);
    source.next();
    source.next();
    assert_eq!(capture.bands(), [0.0; BAND_COUNT]);
}
