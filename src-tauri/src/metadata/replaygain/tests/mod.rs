mod restoration;

use super::*;
use crate::fixtures::wave;
use rodio::Decoder;
use std::fs::File;

fn samples(path: &Path) -> Vec<f32> {
    Decoder::try_from(File::open(path).unwrap())
        .unwrap()
        .collect()
}

#[test]
fn measurement_leaves_untagged_and_tagged_files_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("track.wav");
    wave(&path, 0.1);
    for tagged in [false, true] {
        if tagged {
            replaygain::write(
                &path,
                TrackGain {
                    gain_db: Some(-40.0),
                    peak: Some(0.5),
                },
                true,
            )
            .unwrap();
        }
        let before = fs::read(&path).unwrap();
        let tags = replaygain::read(&path).unwrap();
        let measured = measurement::measure(&path).unwrap();
        assert!(measured.loudness.is_finite());
        assert!((measured.peak - 0.1).abs() < 0.005);
        assert_eq!(before, fs::read(&path).unwrap());
        assert_eq!(tags, replaygain::read(&path).unwrap());
    }
}
