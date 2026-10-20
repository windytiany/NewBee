use super::*;

fn run(session: &mut Session<FakeAudio>, operation: SystemOperation) -> bool {
    execute(session, SessionCommand::System { operation }).0
}

#[test]
fn audio_shortcuts_adjust_authoritative_state_and_clamp_volume() {
    let mut session = fixture();
    run(&mut session, SystemOperation::VolumeUp);
    assert_eq!(session.volume.volume, 55);
    run(&mut session, SystemOperation::VolumeDown);
    assert_eq!(session.volume.volume, 50);
    execute(&mut session, SessionCommand::Volume { volume: 98 });
    run(&mut session, SystemOperation::VolumeUp);
    assert_eq!(session.audio.volume, 100);
    execute(&mut session, SessionCommand::Volume { volume: 2 });
    run(&mut session, SystemOperation::VolumeDown);
    assert_eq!(session.audio.volume, 0);
    run(&mut session, SystemOperation::Mute);
    assert_eq!(session.audio.volume, 2);
    run(&mut session, SystemOperation::Shuffle);
    assert!(session.queue.shuffle_enabled);
    run(&mut session, SystemOperation::Shuffle);
    assert!(!session.queue.shuffle_enabled);
    run(&mut session, SystemOperation::Repeat);
    assert!(session.queue.repeat_one_enabled);
    run(&mut session, SystemOperation::Repeat);
    assert!(!session.queue.repeat_one_enabled);
    assert_eq!(session.generation.load(Ordering::SeqCst), 0);
}

#[test]
fn seeking_shortcuts_use_current_position_and_playback_identity() {
    let mut session = fixture();
    assert!(!run(&mut session, SystemOperation::SeekForward));
    play(&mut session, &[1], 0);
    session.audio.duration = Some(20_000);
    session.audio.position = 8_000;
    let playback_id = session.playback_id;
    assert!(run(&mut session, SystemOperation::SeekForward));
    assert_eq!(session.audio.position, 13_000);
    assert!(run(&mut session, SystemOperation::SeekBackward));
    assert_eq!(session.audio.position, 8_000);
    session.audio.position = 18_000;
    run(&mut session, SystemOperation::SeekForward);
    assert_eq!(session.audio.position, 20_000);
    session.audio.position = 2_000;
    run(&mut session, SystemOperation::SeekBackward);
    assert_eq!(session.audio.position, 0);
    assert_eq!(session.playback_id, playback_id);
    assert!(!session.seeking);
}

#[test]
fn shortcuts_do_not_interrupt_manual_seeking_or_editing() {
    let mut session = fixture();
    play(&mut session, &[1], 0);
    execute(&mut session, SessionCommand::BeginSeeking);
    assert!(!run(&mut session, SystemOperation::SeekForward));
    assert!(!run(&mut session, SystemOperation::Toggle));
    assert!(session.seeking);
    assert!(session.audio.playing);
}
