use super::super::{
    connect_source, is_expected_playback_id, open_decoder, ActivePlayback, ContinuousSource,
    NowPlayingTrack, PlaybackError, PlaybackState, PreparedTrack, AUDIO_FILE_NOT_FOUND_PREFIX,
};
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn spectrum_uses_player_output_and_rejects_inactive_playback_instances() {
    use rodio::buffer::SamplesBuffer;
    use std::f32::consts::PI;
    use std::num::{NonZeroU16, NonZeroU32};
    use std::time::Duration;

    let state = PlaybackState::default();
    assert_eq!(state.spectrum(1).unwrap(), [0.0; 8]);
    let channels = NonZeroU16::new(2).unwrap();
    let sample_rate = NonZeroU32::new(48000).unwrap();
    let samples = (0..2048 * 8)
        .flat_map(|frame| {
            let sample = (2.0 * PI * 960.0 * frame as f32 / 48000.0).sin() * 0.5;
            [sample, -sample]
        })
        .collect::<Vec<_>>();
    let prepared = PreparedTrack {
        track: NowPlayingTrack {
            track_id: 1,
            playback_id: 1,
            title: None,
            artist: None,
            row_key: None,
            previous_playback_id: None,
        },
        duration: Duration::from_secs_f64(2048.0 * 8.0 / 48000.0),
        source: Box::new(SamplesBuffer::new(channels, sample_rate, samples)),
    };
    let (source, continuous, _) =
        ContinuousSource::new(prepared, Default::default(), std::sync::mpsc::channel().0);
    let (mixer, mut output) = rodio::mixer::mixer(channels, sample_rate);
    let (player, spectrum) = connect_source(&mixer, source, 1.0);
    *state.active.lock().unwrap() = Some(ActivePlayback {
        player,
        spectrum,
        continuous,
        channels,
        sample_rate,
    });
    output.by_ref().take(2048 * 2).for_each(drop);
    assert!(state.spectrum(1).unwrap()[4] > 0.8);
    assert_eq!(state.spectrum(2).unwrap(), [0.0; 8]);
    {
        let active = state.active.lock().unwrap();
        active.as_ref().unwrap().player.pause();
    }
    assert_eq!(state.spectrum(1).unwrap(), [0.0; 8]);
    {
        let active = state.active.lock().unwrap();
        let active = active.as_ref().unwrap();
        active.player.play();
        active.player.set_volume(0.0);
    }
    output.by_ref().take(2048 * 4).for_each(drop);
    assert_eq!(state.spectrum(1).unwrap(), [0.0; 8]);
    output.by_ref().take(2048 * 12).for_each(drop);
    assert!(
        state
            .active
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .continuous
            .snapshot()
            .ended
    );
    assert_eq!(state.spectrum(1).unwrap(), [0.0; 8]);
    state.active.lock().unwrap().take();
    assert_eq!(state.spectrum(1).unwrap(), [0.0; 8]);
}

#[test]
fn a_stop_request_only_matches_its_playback_instance() {
    assert!(is_expected_playback_id(Some(12), 12));
    assert!(!is_expected_playback_id(Some(13), 12));
    assert!(!is_expected_playback_id(None, 12));
}

#[test]
fn missing_audio_file_has_a_distinct_startup_error() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    let path = std::env::temp_dir().join(format!("newbee-missing-{unique}.mp3"));
    let message = match open_decoder(&path) {
        Err(error) => error.into_play_command_message(),
        Ok(_) => panic!("the test audio file unexpectedly exists"),
    };

    assert!(message.starts_with(AUDIO_FILE_NOT_FOUND_PREFIX));
    assert!(message.contains("Could not open audio file"));
}

#[test]
fn non_file_errors_are_not_classified_as_missing_audio() {
    let message = PlaybackError::Other("Could not open audio output: unavailable".to_owned())
        .into_play_command_message();

    assert!(!message.starts_with(AUDIO_FILE_NOT_FOUND_PREFIX));
    assert!(message.contains("Could not open audio output"));
}
