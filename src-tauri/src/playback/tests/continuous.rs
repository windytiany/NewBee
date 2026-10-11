use super::{ContinuousSource, PreparedTrack};
use crate::playback::NowPlayingTrack;
use rodio::buffer::SamplesBuffer;
use rodio::Source;
use std::num::{NonZeroU16, NonZeroU32};
use std::time::Duration;

fn track(id: u64, samples: Vec<f32>) -> PreparedTrack {
    PreparedTrack {
        track: NowPlayingTrack {
            track_id: id as i64,
            playback_id: id,
            row_key: Some(id.to_string()),
            previous_playback_id: None,
            title: None,
            artist: None,
        },
        duration: Duration::from_secs_f64(samples.len() as f64 / 48000.0 / 2.0),
        source: Box::new(SamplesBuffer::new(
            NonZeroU16::new(2).unwrap(),
            NonZeroU32::new(48000).unwrap(),
            samples,
        )),
    }
}

#[test]
fn prepared_tracks_join_without_silence_dropped_or_repeated_samples() {
    let (mut source, playback, transitions) = ContinuousSource::new(
        track(1, vec![0.1, 0.2, 0.3, 0.4]),
        Default::default(),
        std::sync::mpsc::channel().0,
    );
    assert!(playback.reserve(1, 1));
    assert!(playback.prepare(1, 1, track(2, vec![0.5, 0.6, 0.7, 0.8])));
    assert_eq!(
        source.by_ref().take(8).collect::<Vec<_>>(),
        vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
    );
    let transition = transitions.try_recv().unwrap();
    assert_eq!(transition.playback_id, 2);
    assert_eq!(transition.previous_playback_id, Some(1));
    assert_eq!(playback.snapshot().track.playback_id, 2);
    assert!(!playback.snapshot().ended);
    assert_eq!(source.next(), Some(0.0));
    assert!(playback.snapshot().ended);
}

fn wav_track(id: u64, samples: &[i16]) -> PreparedTrack {
    let data_len = (samples.len() * 2) as u32;
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&48000u32.to_le_bytes());
    wav.extend_from_slice(&192000u32.to_le_bytes());
    wav.extend_from_slice(&4u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    let byte_len = wav.len() as u64;
    let decoder = rodio::Decoder::builder()
        .with_data(std::io::Cursor::new(wav))
        .with_byte_len(byte_len)
        .build()
        .unwrap();
    let mut prepared = track(id, Vec::new());
    prepared.duration = decoder.total_duration().unwrap();
    prepared.source = Box::new(decoder);
    super::super::normalize_track(
        prepared,
        NonZeroU16::new(2).unwrap(),
        NonZeroU32::new(48000).unwrap(),
    )
}

#[test]
fn decoded_wavs_join_sample_exactly_through_the_player_and_mixer() {
    let samples = [1024, -1024, 2048, -2048, 4096, -4096, 8192, -8192];
    let (source, playback, _) = ContinuousSource::new(
        wav_track(1, &samples[..4]),
        Default::default(),
        std::sync::mpsc::channel().0,
    );
    assert!(playback.reserve(1, 1));
    assert!(playback.prepare(1, 1, wav_track(2, &samples[4..])));
    let (mixer, output) =
        rodio::mixer::mixer(NonZeroU16::new(2).unwrap(), NonZeroU32::new(48000).unwrap());
    let _player = super::super::connect_source(&mixer, source, 1.0);
    assert_eq!(
        output.take(8).collect::<Vec<_>>(),
        vec![0.03125, -0.03125, 0.0625, -0.0625, 0.125, -0.125, 0.25, -0.25]
    );
    assert_eq!(playback.snapshot().track.playback_id, 2);
}

#[test]
fn seeking_back_from_the_end_rearms_the_source() {
    let (mut source, playback, _) = ContinuousSource::new(
        wav_track(1, &[1024, -1024, 2048, -2048]),
        Default::default(),
        std::sync::mpsc::channel().0,
    );
    source.by_ref().take(5).for_each(drop);
    assert!(playback.snapshot().ended);
    source.try_seek(Duration::ZERO).unwrap();
    assert!(!playback.snapshot().ended);
    assert_eq!(
        source.by_ref().take(4).collect::<Vec<_>>(),
        vec![0.03125, -0.03125, 0.0625, -0.0625]
    );
}

#[test]
fn cancelling_the_reservation_keeps_the_next_track_out_of_the_output() {
    let (mut source, playback, transitions) = ContinuousSource::new(
        track(1, vec![0.1, 0.2]),
        Default::default(),
        std::sync::mpsc::channel().0,
    );
    assert!(playback.reserve(1, 1));
    assert!(playback.prepare(1, 1, track(2, vec![0.3, 0.4])));
    assert!(playback.reserve(1, 2));
    assert_eq!(
        source.by_ref().take(4).collect::<Vec<_>>(),
        vec![0.1, 0.2, 0.0, 0.0]
    );
    assert!(playback.snapshot().ended);
    assert!(transitions.try_recv().is_err());
}

#[test]
fn a_track_flagged_after_preparation_is_never_emitted_at_the_audio_boundary() {
    let skipped = std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashSet::new()));
    let (mut source, playback, transitions) = ContinuousSource::new(
        track(1, vec![0.1, 0.2]),
        skipped.clone(),
        std::sync::mpsc::channel().0,
    );
    assert!(playback.reserve(1, 1));
    assert!(playback.prepare(1, 1, track(2, vec![0.3, 0.4])));
    skipped.write().unwrap().insert(2);
    assert_eq!(
        source.by_ref().take(4).collect::<Vec<_>>(),
        vec![0.1, 0.2, 0.0, 0.0]
    );
    assert!(transitions.try_recv().is_err());
    assert!(playback.snapshot().ended);
}

#[test]
fn cancelling_skip_before_the_boundary_allows_the_prepared_track() {
    let skipped = std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashSet::from([2])));
    let (source, playback, transitions) = ContinuousSource::new(
        track(1, vec![0.1, 0.2]),
        skipped.clone(),
        std::sync::mpsc::channel().0,
    );
    assert!(playback.reserve(1, 1));
    assert!(playback.prepare(1, 1, track(2, vec![0.3, 0.4])));
    skipped.write().unwrap().remove(&2);
    assert_eq!(source.take(4).collect::<Vec<_>>(), vec![0.1, 0.2, 0.3, 0.4]);
    assert_eq!(transitions.try_recv().unwrap().track_id, 2);
}

#[test]
fn explicit_initial_playback_ignores_skip_but_repeat_transitions_do_not() {
    let skipped = std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashSet::from([1])));
    let (source, playback, transitions) = ContinuousSource::new(
        track(1, vec![0.1, 0.2]),
        skipped,
        std::sync::mpsc::channel().0,
    );
    assert!(playback.reserve(1, 1));
    let mut repeated = track(2, vec![0.3, 0.4]);
    repeated.track.track_id = 1;
    assert!(playback.prepare(1, 1, repeated));
    assert_eq!(source.take(4).collect::<Vec<_>>(), vec![0.1, 0.2, 0.0, 0.0]);
    assert!(transitions.try_recv().is_err());
}

#[test]
fn replacing_a_reservation_never_plays_the_stale_next_track() {
    let (source, playback, _) = ContinuousSource::new(
        track(1, vec![0.1, 0.2]),
        Default::default(),
        std::sync::mpsc::channel().0,
    );
    assert!(playback.reserve(1, 1));
    assert!(playback.prepare(1, 1, track(2, vec![0.3, 0.4])));
    assert!(playback.reserve(1, 2));
    assert!(!playback.prepare(1, 1, track(2, vec![0.3, 0.4])));
    assert!(playback.prepare(1, 2, track(3, vec![0.5, 0.6])));
    assert_eq!(source.take(4).collect::<Vec<_>>(), vec![0.1, 0.2, 0.5, 0.6]);
    assert!(!playback.reserve(1, 3));
}
