use rodio::Player;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const FADE_DURATION: Duration = Duration::from_millis(200);
const FADE_INTERVAL: Duration = Duration::from_millis(10);

pub(super) struct Transport(Arc<Mutex<Output>>);

struct Output {
    player: Player,
    volume: f32,
    gain: f32,
    playing: bool,
    revision: u64,
    ramp: Option<Ramp>,
}

struct Ramp {
    started: Instant,
    from: f32,
    to: f32,
}

impl Output {
    fn advance(&mut self, now: Instant, revision: u64) -> bool {
        if revision != self.revision {
            return false;
        }
        let Some(ramp) = &self.ramp else {
            return false;
        };
        let progress =
            (now.duration_since(ramp.started).as_secs_f32() / FADE_DURATION.as_secs_f32()).min(1.0);
        self.gain = ramp.from + (ramp.to - ramp.from) * progress;
        self.player.set_volume(self.volume * self.gain);
        if progress >= 1.0 {
            self.finish();
            return false;
        }
        true
    }

    fn set_volume(&mut self, volume: f32, now: Instant) {
        self.advance(now, self.revision);
        self.volume = volume;
        self.player.set_volume(volume * self.gain);
    }

    fn finish(&mut self) {
        self.ramp = None;
        self.gain = if self.playing { 1.0 } else { 0.0 };
        self.player.set_volume(self.volume * self.gain);
        if !self.playing {
            self.player.pause();
        }
    }

    fn transition(&mut self, playing: bool, fade: bool, now: Instant) -> u64 {
        self.advance(now, self.revision);
        self.revision += 1;
        self.playing = playing;
        if playing {
            self.player.play();
        }
        if fade {
            self.ramp = Some(Ramp {
                started: now,
                from: self.gain,
                to: if playing { 1.0 } else { 0.0 },
            });
        } else {
            self.finish();
        }
        self.revision
    }
}

impl Transport {
    pub(super) fn new(player: Player, volume: f32, fade: bool) -> Self {
        let transport = Self(Arc::new(Mutex::new(Output {
            player,
            volume,
            gain: if fade { 0.0 } else { 1.0 },
            playing: true,
            revision: 0,
            ramp: None,
        })));
        transport.set_playing(true, fade);
        transport
    }

    pub(super) fn set_playing(&self, playing: bool, fade: bool) {
        let mut output = self.0.lock().unwrap();
        let revision = output.transition(playing, fade, Instant::now());
        if output.ramp.is_none() {
            return;
        }
        drop(output);
        let weak = Arc::downgrade(&self.0);
        std::thread::spawn(move || loop {
            std::thread::sleep(FADE_INTERVAL);
            let Some(output) = weak.upgrade() else {
                break;
            };
            if !output.lock().unwrap().advance(Instant::now(), revision) {
                break;
            }
        });
    }

    pub(super) fn finish(&self) {
        let mut output = self.0.lock().unwrap();
        output.revision += 1;
        output.finish();
    }

    pub(super) fn set_volume(&self, volume: f32) {
        self.0.lock().unwrap().set_volume(volume, Instant::now());
    }

    pub(super) fn is_paused(&self) -> bool {
        !self.0.lock().unwrap().playing
    }

    pub(super) fn stop(&self) {
        let mut output = self.0.lock().unwrap();
        output.revision += 1;
        output.playing = false;
        output.finish();
        output.player.stop();
    }

    pub(super) fn try_seek(&self, position: Duration) -> Result<(), rodio::source::SeekError> {
        self.0.lock().unwrap().player.try_seek(position)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn output() -> Output {
        Output {
            player: Player::new().0,
            volume: 0.8,
            gain: 1.0,
            playing: true,
            revision: 0,
            ramp: None,
        }
    }

    #[test]
    fn reversing_a_fade_cancels_the_old_pause() {
        let mut output = output();
        let start = Instant::now();
        let pause = output.transition(false, true, start);
        assert!(!output.playing);
        assert!(!output.player.is_paused());
        let middle = start + FADE_DURATION / 2;
        assert!(output.advance(middle, pause));
        assert!((output.gain - 0.5).abs() < 0.001);
        let resume = output.transition(true, true, middle);
        assert!(!output.advance(start + FADE_DURATION, pause));
        assert!(output.playing);
        assert!(!output.player.is_paused());
        assert!(!output.advance(middle + FADE_DURATION, resume));
        assert_eq!(output.player.volume(), 0.8);
        let pause = output.transition(false, true, middle + FADE_DURATION);
        assert!(!output.advance(middle + FADE_DURATION * 2, pause));
        assert!(output.player.is_paused());
        assert_eq!(output.player.volume(), 0.0);
    }

    #[test]
    fn volume_and_disabling_fades_preserve_the_pause_target() {
        let transport = Transport(Arc::new(Mutex::new(output())));
        let start = Instant::now();
        let revision = transport.0.lock().unwrap().transition(false, true, start);
        {
            let mut output = transport.0.lock().unwrap();
            output.set_volume(0.4, start + FADE_DURATION / 2);
            assert_eq!(output.volume, 0.4);
            assert!((output.player.volume() - 0.2).abs() < 0.001);
            assert!(!output.player.is_paused());
        }
        transport.finish();
        let mut output = transport.0.lock().unwrap();
        assert!(output.player.is_paused());
        assert_eq!(output.player.volume(), 0.0);
        assert!(!output.advance(start + FADE_DURATION, revision));
        output.transition(true, false, start + FADE_DURATION);
        assert!(!output.player.is_paused());
        assert_eq!(output.player.volume(), 0.4);
    }
}
