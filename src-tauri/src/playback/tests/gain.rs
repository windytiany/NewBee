use super::*;
use crate::metadata::files::replaygain::TrackGain;
use crate::playback::PlaybackState;
use rodio::buffer::SamplesBuffer;
use std::num::{NonZeroU16, NonZeroU32};

fn source(samples: Vec<f32>, gain: TrackGain, state: &PlaybackState) -> GainSource<SamplesBuffer> {
    let applied_preamp = state.replay_gain_preamp.load(Ordering::Relaxed);
    GainSource {
        source: SamplesBuffer::new(
            NonZeroU16::new(1).unwrap(),
            NonZeroU32::new(2).unwrap(),
            samples,
        ),
        gain,
        amplitude: amplitude(gain, f64::from_bits(applied_preamp)),
        applied_preamp,
        preamp: state.replay_gain_preamp.clone(),
        enabled: state.replay_gain.clone(),
    }
}

fn attenuation(amplitude: f64) -> TrackGain {
    TrackGain {
        gain_db: Some(20.0 * amplitude.log10()),
        peak: None,
    }
}

#[test]
fn missing_gain_and_peak_prevent_unsafe_amplification() {
    assert_eq!(amplitude(TrackGain::default(), 0.0), 1.0);
    assert_eq!(
        amplitude(
            TrackGain {
                gain_db: Some(6.0),
                peak: None
            },
            0.0
        ),
        1.0
    );
    assert_eq!(
        amplitude(
            TrackGain {
                gain_db: Some(20.0),
                peak: Some(0.5)
            },
            0.0
        ),
        2.0
    );
    assert!(
        (amplitude(
            TrackGain {
                gain_db: Some(-6.0),
                peak: Some(0.8)
            },
            0.0
        ) - 0.5011872)
            .abs()
            < 0.00001
    );
    assert_eq!(
        amplitude(
            TrackGain {
                gain_db: None,
                peak: Some(2.0)
            },
            0.0
        ),
        1.0
    );
}

#[test]
fn toggle_seek_duration_and_user_volume_preserve_the_source_contract() {
    let state = PlaybackState::default();
    let mut audio = source(vec![0.8, 0.6, 0.4, 0.2], attenuation(0.5), &state);
    assert_eq!(audio.total_duration(), Some(Duration::from_secs(2)));
    assert_eq!(audio.channels().get(), 1);
    assert_eq!(audio.sample_rate().get(), 2);
    assert_eq!(audio.next(), Some(0.4));
    state.set_replay_gain(false, 0.0);
    assert_eq!(audio.next(), Some(0.6));
    audio.try_seek(Duration::from_secs(1)).unwrap();
    state.set_replay_gain(true, 0.0);
    assert_eq!(audio.next(), Some(0.2));
    let mut volume = source(vec![0.8], attenuation(0.5), &state).amplify(0.25);
    assert_eq!(volume.next(), Some(0.1));
}

#[test]
fn reads_tags_but_untagged_and_unreadable_metadata_keep_original_gain() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("track.wav");
    crate::fixtures::wave(&path, 0.1);
    let state = PlaybackState::default();
    state.set_replay_gain(true, -6.0);
    let make = || {
        let samples = SamplesBuffer::new(
            NonZeroU16::new(1).unwrap(),
            NonZeroU32::new(2).unwrap(),
            vec![0.8],
        );
        GainSource::new(
            samples,
            &path,
            state.replay_gain.clone(),
            state.replay_gain_preamp.clone(),
        )
    };
    assert_eq!(make().next(), Some(0.8));
    replaygain::write(
        &path,
        TrackGain {
            gain_db: Some(-6.0206),
            peak: Some(0.8),
        },
        true,
    )
    .unwrap();
    assert!((make().next().unwrap() - 0.200475).abs() < 0.001);
    let samples = SamplesBuffer::new(
        NonZeroU16::new(1).unwrap(),
        NonZeroU32::new(2).unwrap(),
        vec![0.8],
    );
    assert_eq!(
        GainSource::new(
            samples,
            &dir.path().join("missing.wav"),
            state.replay_gain.clone(),
            state.replay_gain_preamp.clone(),
        )
        .next(),
        Some(0.8)
    );
}

#[test]
fn preamp_updates_current_audio_and_is_bypassed_when_replay_gain_is_off() {
    let state = PlaybackState::default();
    let mut audio = source(vec![0.8; 5], attenuation(0.5), &state);
    assert_eq!(audio.next(), Some(0.4));
    state.set_replay_gain(true, 6.0);
    assert!((audio.next().unwrap() - 0.798105).abs() < 0.00001);
    state.set_replay_gain(false, -6.0);
    assert_eq!(audio.next(), Some(0.8));
    state.set_replay_gain(true, -6.0);
    assert!((audio.next().unwrap() - 0.200475).abs() < 0.00001);
    state.set_replay_gain(true, 0.0);
    assert_eq!(audio.next(), Some(0.4));
}

#[test]
fn preamp_needs_a_gain_tag_but_zero_db_is_a_valid_tag() {
    let state = PlaybackState::default();
    state.set_replay_gain(true, -20.0);
    for gain in [
        TrackGain::default(),
        TrackGain {
            gain_db: None,
            peak: Some(0.5),
        },
    ] {
        assert_eq!(source(vec![0.8], gain, &state).next(), Some(0.8));
    }
    assert!((source(vec![0.8], attenuation(1.0), &state).next().unwrap() - 0.08).abs() < 0.00001);
}

#[test]
fn preamp_is_combined_before_peak_limiting_including_runtime_changes() {
    let state = PlaybackState::default();
    let mut audio = source(
        vec![0.5; 3],
        TrackGain {
            gain_db: Some(20.0),
            peak: Some(0.5),
        },
        &state,
    );
    assert_eq!(audio.next(), Some(1.0));
    state.set_replay_gain(true, -20.0);
    assert_eq!(audio.next(), Some(0.5));
    state.set_replay_gain(true, 20.0);
    assert_eq!(audio.next(), Some(1.0));
    assert_eq!(
        source(vec![0.8], attenuation(1.0), &state).next(),
        Some(0.8)
    );
}

#[test]
fn preloaded_tracks_have_independent_gain_and_share_live_preferences() {
    use crate::playback::{
        continuous::{ContinuousSource, PreparedTrack},
        NowPlayingTrack,
    };
    let state = PlaybackState::default();
    let track = |id: u64, amplitude| PreparedTrack {
        track: NowPlayingTrack {
            track_id: None,
            path: None,
            playback_id: id,
            row_key: None,
            previous_playback_id: None,
            title: None,
            artist: None,
        },
        duration: Duration::from_secs(1),
        source: Box::new(source(vec![0.8, 0.8], attenuation(amplitude), &state)),
    };
    let (mut audio, playback, _) = ContinuousSource::new(
        track(1, 0.5),
        Default::default(),
        std::sync::mpsc::channel().0,
    );
    assert!(playback.reserve(1, 1));
    assert!(playback.prepare(1, 1, track(2, 0.25)));
    assert_eq!(audio.by_ref().take(2).collect::<Vec<_>>(), vec![0.4, 0.4]);
    state.set_replay_gain(true, -6.0);
    for sample in audio.take(2) {
        assert!((sample - 0.100237).abs() < 0.00001);
    }
}
