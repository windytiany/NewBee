use super::*;

#[test]
fn parses_units_and_rejects_invalid_values_without_unsafe_amplification() {
    assert_eq!(gain(" +3.25 dB "), Some(3.25));
    assert_eq!(gain("-9.5 DB"), Some(-9.5));
    assert_eq!(gain("2"), Some(2.0));
    for value in ["NaN", "inf", "-inf", "1000 dB", "abc", "🦀", "3 dB junk"] {
        assert_eq!(gain(value), None, "{value}");
    }
    assert_eq!(TrackGain::default().amplitude(0.0), 1.0);
    assert_eq!(
        TrackGain {
            gain_db: Some(6.0),
            peak: None
        }
        .amplitude(0.0),
        1.0
    );
    assert_eq!(
        TrackGain {
            gain_db: Some(20.0),
            peak: Some(0.5)
        }
        .amplitude(0.0),
        2.0
    );
    assert!((measured().amplitude(0.0) - 0.5011872).abs() < 0.00001);
    assert_eq!(
        TrackGain {
            gain_db: None,
            peak: Some(2.0)
        }
        .amplitude(0.0),
        1.0
    );
}
