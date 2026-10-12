use super::*;
use rodio::buffer::SamplesBuffer;
use std::num::{NonZeroU16, NonZeroU32};

fn track(playback_id: u64, duration: Duration, samples: usize) -> PreparedTrack {
    PreparedTrack {
        track: NowPlayingTrack {
            track_id: Some(1),
            path: None,
            playback_id,
            title: None,
            artist: None,
            row_key: Some("song".into()),
            previous_playback_id: None,
        },
        duration,
        source: Box::new(SamplesBuffer::new(
            NonZeroU16::new(1).unwrap(),
            NonZeroU32::new(100).unwrap(),
            vec![0.1; samples],
        )),
    }
}

#[test]
fn counts_on_entering_the_final_three_seconds_and_not_again_at_end() {
    let (sender, receiver) = mpsc::channel();
    let (mut source, _, _) = ContinuousSource::new(
        track(1, Duration::from_secs(10), 1000),
        Default::default(),
        sender,
    );
    source.by_ref().take(699).for_each(drop);
    assert!(receiver.try_recv().is_err());
    source.next();
    assert_eq!(receiver.try_recv().unwrap(), 1);
    source.by_ref().take(400).for_each(drop);
    assert!(receiver.try_recv().is_err());
}

#[test]
fn interruption_before_the_threshold_never_counts() {
    let (sender, receiver) = mpsc::channel();
    let (mut source, _, _) = ContinuousSource::new(
        track(1, Duration::from_secs(10), 1000),
        Default::default(),
        sender,
    );
    source.by_ref().take(699).for_each(drop);
    drop(source);
    assert!(receiver.try_recv().is_err());
}

#[test]
fn short_gapless_repeats_each_count_once_without_polling() {
    let (sender, receiver) = mpsc::channel();
    let (mut source, playback, _) = ContinuousSource::new(
        track(1, Duration::from_secs(1), 100),
        Default::default(),
        sender,
    );
    playback.reserve(1, 1);
    playback.prepare(1, 1, track(2, Duration::from_secs(1), 100));
    source.by_ref().take(100).for_each(drop);
    assert!(receiver.try_recv().is_err());
    source.next();
    assert_eq!(receiver.try_recv().unwrap(), 1);
    source.by_ref().take(100).for_each(drop);
    assert_eq!(receiver.try_recv().unwrap(), 1);
    source.by_ref().take(100).for_each(drop);
    assert!(receiver.try_recv().is_err());
}

#[test]
fn unknown_duration_counts_only_at_the_audio_end() {
    let (sender, receiver) = mpsc::channel();
    let (mut source, playback, _) =
        ContinuousSource::new(track(1, Duration::ZERO, 100), Default::default(), sender);
    source.by_ref().take(100).for_each(drop);
    assert!(receiver.try_recv().is_err());
    assert_eq!(playback.snapshot().position, Duration::from_secs(1));
    source.next();
    assert_eq!(receiver.try_recv().unwrap(), 1);
}

#[test]
fn forward_and_backward_seeks_disqualify_until_a_new_round() {
    for position in [Duration::ZERO, Duration::from_secs(8)] {
        let (sender, receiver) = mpsc::channel();
        let (mut source, playback, _) = ContinuousSource::new(
            track(1, Duration::from_secs(10), 1000),
            Default::default(),
            sender,
        );
        source.by_ref().take(100).for_each(drop);
        source.try_seek(position).unwrap();
        playback.reserve(1, 1);
        playback.prepare(1, 1, track(2, Duration::from_secs(1), 100));
        source.by_ref().take(1200).for_each(drop);
        assert_eq!(receiver.try_iter().collect::<Vec<_>>(), vec![1]);
    }
}

#[test]
fn seeking_to_the_same_position_does_not_disqualify_playback() {
    let (sender, receiver) = mpsc::channel();
    let (mut source, _, _) = ContinuousSource::new(
        track(1, Duration::from_secs(10), 1000),
        Default::default(),
        sender,
    );
    source.by_ref().take(100).for_each(drop);
    source.try_seek(Duration::from_secs(1)).unwrap();
    source.by_ref().take(600).for_each(drop);
    assert_eq!(receiver.try_iter().collect::<Vec<_>>(), vec![1]);
}

#[test]
fn playback_speed_does_not_change_the_count() {
    for speed in [0.5, 2.0] {
        let (sender, receiver) = mpsc::channel();
        let (source, _, _) = ContinuousSource::new(
            track(1, Duration::from_secs(10), 1000),
            Default::default(),
            sender,
        );
        let (mixer, mut output) =
            rodio::mixer::mixer(NonZeroU16::new(1).unwrap(), NonZeroU32::new(100).unwrap());
        let (player, _) = super::super::connect_source(&mixer, source, 1.0);
        player.set_speed(speed);
        output.by_ref().take(100).for_each(drop);
        assert!(receiver.try_recv().is_err());
        output.by_ref().take(2200).for_each(drop);
        assert_eq!(receiver.try_iter().collect::<Vec<_>>(), vec![1]);
    }
}

#[test]
fn pause_and_resume_do_not_advance_or_reset_the_round() {
    let (sender, receiver) = mpsc::channel();
    let (source, _, _) = ContinuousSource::new(
        track(1, Duration::from_secs(10), 1000),
        Default::default(),
        sender,
    );
    let (mixer, mut output) =
        rodio::mixer::mixer(NonZeroU16::new(1).unwrap(), NonZeroU32::new(100).unwrap());
    let (player, _) = super::super::connect_source(&mixer, source, 1.0);
    output.by_ref().take(100).for_each(drop);
    player.pause();
    output.by_ref().take(1000).for_each(drop);
    assert!(receiver.try_recv().is_err());
    player.play();
    output.by_ref().take(700).for_each(drop);
    assert_eq!(receiver.try_recv().unwrap(), 1);
    assert!(receiver.try_recv().is_err());
}

#[test]
fn inbox_audition_never_counts_even_when_same_file_is_in_the_library() {
    for library_source in [false, true] {
        let mut prepared = track(1, Duration::from_secs(10), 1000);
        prepared.track.path = Some("same-file.wav".into());
        if !library_source {
            prepared.track.track_id = None;
        }
        let (sender, receiver) = mpsc::channel();
        let (mut source, _, _) = ContinuousSource::new(prepared, Default::default(), sender);
        source.by_ref().take(1200).for_each(drop);
        assert_eq!(
            receiver.try_iter().collect::<Vec<_>>(),
            if library_source { vec![1] } else { vec![] }
        );
    }
}
