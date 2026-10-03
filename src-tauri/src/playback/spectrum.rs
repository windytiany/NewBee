use rodio::{ChannelCount, SampleRate, Source};
use std::f32::consts::PI;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub const BAND_COUNT: usize = 8;
const FFT_SIZE: usize = 2048;
const CAPTURE_FRAMES: usize = FFT_SIZE * 2;
const BAND_EDGES_HZ: [f32; BAND_COUNT + 1] = [
    40.0, 80.0, 160.0, 320.0, 640.0, 1280.0, 2560.0, 5120.0, 16000.0,
];
const FLOOR_DB: f32 = -60.0;

/// A single audio-thread writer publishes complete interleaved frames.
/// Readers copy the latest window and do FFT work away from the audio thread.
pub struct SpectrumCapture {
    samples: Box<[AtomicU32]>,
    frames: AtomicU64,
    reset_frame: AtomicU64,
    channels: usize,
    sample_rate: f32,
}

impl SpectrumCapture {
    fn new(channels: ChannelCount, sample_rate: SampleRate) -> Self {
        let channels = usize::from(channels.get());
        Self {
            samples: (0..CAPTURE_FRAMES * channels)
                .map(|_| AtomicU32::new(0))
                .collect(),
            frames: AtomicU64::new(0),
            reset_frame: AtomicU64::new(0),
            channels,
            sample_rate: sample_rate.get() as f32,
        }
    }

    pub fn reset(&self) {
        self.reset_frame
            .store(self.frames.load(Ordering::Acquire), Ordering::Release);
    }

    pub fn bands(&self) -> [f32; BAND_COUNT] {
        let end = self.frames.load(Ordering::Acquire);
        let reset = self.reset_frame.load(Ordering::Acquire);
        let start = end.saturating_sub(FFT_SIZE as u64).max(reset);
        let count = end.saturating_sub(start) as usize;
        if count == 0 {
            return [0.0; BAND_COUNT];
        }
        let mut window = vec![0.0; FFT_SIZE * self.channels];
        for frame in 0..count {
            let source = ((start + frame as u64) % CAPTURE_FRAMES as u64) as usize * self.channels;
            let destination = (FFT_SIZE - count + frame) * self.channels;
            for channel in 0..self.channels {
                window[destination + channel] =
                    f32::from_bits(self.samples[source + channel].load(Ordering::Relaxed));
            }
        }
        // The extra window of ring capacity keeps normal reads clear of writes.
        // If the reader was suspended long enough to be overtaken, discard it.
        if self.frames.load(Ordering::Acquire).saturating_sub(end) >= FFT_SIZE as u64
            || self.reset_frame.load(Ordering::Acquire) != reset
        {
            return [0.0; BAND_COUNT];
        }
        analyze(&window, self.channels, self.sample_rate)
    }
}

pub struct SpectrumSource<S> {
    inner: S,
    capture: Arc<SpectrumCapture>,
    samples_written: u64,
}

impl<S: Source> SpectrumSource<S> {
    pub fn new(inner: S) -> (Self, Arc<SpectrumCapture>) {
        let capture = Arc::new(SpectrumCapture::new(inner.channels(), inner.sample_rate()));
        (
            Self {
                inner,
                capture: capture.clone(),
                samples_written: 0,
            },
            capture,
        )
    }
}

impl<S: Source> Iterator for SpectrumSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;
        let captured = if sample.is_finite() { sample } else { 0.0 };
        let index = (self.samples_written % self.capture.samples.len() as u64) as usize;
        self.capture.samples[index].store(captured.to_bits(), Ordering::Relaxed);
        self.samples_written += 1;
        if self
            .samples_written
            .is_multiple_of(self.capture.channels as u64)
        {
            self.capture.frames.store(
                self.samples_written / self.capture.channels as u64,
                Ordering::Release,
            );
        }
        Some(sample)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

impl<S: Source> Source for SpectrumSource<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }

    fn channels(&self) -> ChannelCount {
        self.inner.channels()
    }

    fn sample_rate(&self) -> SampleRate {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    fn try_seek(&mut self, position: Duration) -> Result<(), rodio::source::SeekError> {
        self.inner.try_seek(position)?;
        self.capture.reset();
        Ok(())
    }
}

fn analyze(samples: &[f32], channels: usize, sample_rate: f32) -> [f32; BAND_COUNT] {
    let mut power = [0.0; BAND_COUNT];
    for channel in 0..channels {
        let mean = samples.iter().skip(channel).step_by(channels).sum::<f32>() / FFT_SIZE as f32;
        let mut real = [0.0; FFT_SIZE];
        let mut imaginary = [0.0; FFT_SIZE];
        for (frame, value) in real.iter_mut().enumerate() {
            let hann = 0.5 - 0.5 * (2.0 * PI * frame as f32 / FFT_SIZE as f32).cos();
            *value = (samples[frame * channels + channel] - mean) * hann;
        }
        fft(&mut real, &mut imaginary);
        for bin in 1..FFT_SIZE / 2 {
            let frequency = bin as f32 * sample_rate / FFT_SIZE as f32;
            let Some(band) = BAND_EDGES_HZ
                .windows(2)
                .position(|edges| frequency >= edges[0] && frequency < edges[1])
            else {
                continue;
            };
            power[band] += real[bin] * real[bin] + imaginary[bin] * imaginary[bin];
        }
    }
    // Combine channel power rather than downmixing samples: out-of-phase stereo
    // must remain visible. Hann normalization makes levels stable across rates.
    power.map(|power| {
        let amplitude = (power / channels as f32).sqrt() * 4.0 / FFT_SIZE as f32;
        let db = 20.0 * amplitude.max(0.000001).log10();
        ((db - FLOOR_DB) / -FLOOR_DB).clamp(0.0, 1.0)
    })
}

fn fft(real: &mut [f32; FFT_SIZE], imaginary: &mut [f32; FFT_SIZE]) {
    let mut reversed = 0;
    for index in 1..FFT_SIZE {
        let mut bit = FFT_SIZE >> 1;
        while reversed & bit != 0 {
            reversed ^= bit;
            bit >>= 1;
        }
        reversed ^= bit;
        if index < reversed {
            real.swap(index, reversed);
            imaginary.swap(index, reversed);
        }
    }
    let mut size = 2;
    while size <= FFT_SIZE {
        let angle = -2.0 * PI / size as f32;
        let (step_imaginary, step_real) = angle.sin_cos();
        for start in (0..FFT_SIZE).step_by(size) {
            let mut twiddle_real = 1.0;
            let mut twiddle_imaginary = 0.0;
            for offset in 0..size / 2 {
                let even = start + offset;
                let odd = even + size / 2;
                let odd_real = real[odd] * twiddle_real - imaginary[odd] * twiddle_imaginary;
                let odd_imaginary = real[odd] * twiddle_imaginary + imaginary[odd] * twiddle_real;
                real[odd] = real[even] - odd_real;
                imaginary[odd] = imaginary[even] - odd_imaginary;
                real[even] += odd_real;
                imaginary[even] += odd_imaginary;
                let next_real = twiddle_real * step_real - twiddle_imaginary * step_imaginary;
                twiddle_imaginary = twiddle_real * step_imaginary + twiddle_imaginary * step_real;
                twiddle_real = next_real;
            }
        }
        size *= 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;
    use std::num::{NonZeroU16, NonZeroU32};

    fn tone(frequency: f32, amplitude: f32, sample_rate: u32, frames: usize) -> Vec<f32> {
        (0..frames)
            .map(|frame| {
                (2.0 * PI * frequency * frame as f32 / sample_rate as f32).sin() * amplitude
            })
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
}
