use super::*;

#[test]
fn parses_units_and_rejects_invalid_values() {
    assert_eq!(gain(" +3.25 dB "), Some(3.25));
    assert_eq!(gain("-9.5 DB"), Some(-9.5));
    assert_eq!(gain("2"), Some(2.0));
    for value in ["NaN", "inf", "-inf", "1000 dB", "abc", "🦀", "3 dB junk"] {
        assert_eq!(gain(value), None, "{value}");
    }
}
