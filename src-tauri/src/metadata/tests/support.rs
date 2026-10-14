use crate::metadata::model::{MetadataChange, MetadataField};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

pub(in crate::metadata) struct Fixture(pub(in crate::metadata) PathBuf);
impl Fixture {
    pub(in crate::metadata) fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "newbee-metadata-test-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(fs::canonicalize(path).unwrap())
    }
    pub(in crate::metadata) fn wav(&self) -> PathBuf {
        let path = self.0.join("track.wav");
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&8036u32.to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&8000u32.to_le_bytes());
        bytes.extend_from_slice(&8000u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&8u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&8000u32.to_le_bytes());
        bytes.extend_from_slice(&[128; 8000]);
        fs::write(&path, bytes).unwrap();
        path
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap()
    }
}
// The existing fixture contains complete ADTS frames. Repeating them makes a
// legal approximately 140-second AAC stream without re-encoding its payload.
pub(in crate::metadata) fn long_aac_audio() -> Vec<u8> {
    include_bytes!("../../../fixtures/silence.aac").repeat(1024)
}

pub(in crate::metadata) fn change(field: MetadataField, value: Option<&str>) -> MetadataChange {
    MetadataChange {
        values: Vec::new(),
        field,
        value: value.map(str::to_owned),
    }
}
