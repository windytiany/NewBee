use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
};

const MAX_PHOTO_BYTES: usize = 20 * 1024 * 1024;
const PHOTO_SIZE: u32 = 512;

fn path(directory: &Path, artist: &str) -> Result<PathBuf, String> {
    if artist.trim().is_empty() {
        return Err("演出者名称不能为空".to_owned());
    }
    let digest = Sha256::digest(artist.as_bytes());
    Ok(directory.join(format!("{digest:x}.webp")))
}

pub(super) fn read(directory: &Path, artist: &str) -> Result<Vec<u8>, String> {
    match std::fs::read(path(directory, artist)?) {
        Ok(data) => Ok(data),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("读取演出者照片失败：{error}")),
    }
}

pub(super) fn save(directory: &Path, artist: &str, data: &[u8]) -> Result<(), String> {
    let destination = path(directory, artist)?;
    if data.is_empty() || data.len() > MAX_PHOTO_BYTES {
        return Err("照片为空或超过 20 MiB。".to_owned());
    }
    let photo = crate::artwork::encoding::thumbnail(data, PHOTO_SIZE)?;
    std::fs::create_dir_all(directory).map_err(|error| format!("创建照片目录失败：{error}"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)
        .map_err(|error| format!("创建照片文件失败：{error}"))?;
    temporary
        .write_all(&photo)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| format!("写入演出者照片失败：{error}"))?;
    temporary
        .persist(destination)
        .map_err(|error| format!("保存演出者照片失败：{error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
    use std::io::Cursor;

    fn picture(color: [u8; 3]) -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(RgbImage::from_pixel(800, 600, Rgb(color)))
            .write_to(&mut output, ImageFormat::Png)
            .unwrap();
        output.into_inner()
    }

    #[test]
    fn persists_replaces_and_bounds_photos_without_source_files() {
        let temporary = tempfile::tempdir().unwrap();
        let directory = temporary.path().join("photos");
        assert!(read(&directory, "Joy Division").unwrap().is_empty());
        save(&directory, "Joy Division", &picture([255, 0, 0])).unwrap();
        let original = read(&directory, "Joy Division").unwrap();
        let decoded = image::load_from_memory(&original).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (512, 384));
        save(&directory, "Joy Division", &picture([0, 0, 255])).unwrap();
        assert_ne!(read(&directory, "Joy Division").unwrap(), original);
        assert_eq!(std::fs::read_dir(directory).unwrap().count(), 1);
    }

    #[test]
    fn invalid_imports_preserve_the_saved_photo() {
        let temporary = tempfile::tempdir().unwrap();
        let directory = temporary.path();
        save(directory, "Artist", &picture([255, 0, 0])).unwrap();
        let original = read(directory, "Artist").unwrap();
        for data in [
            Vec::new(),
            b"https://example.com/photo.png".to_vec(),
            vec![0; MAX_PHOTO_BYTES + 1],
        ] {
            assert!(save(directory, "Artist", &data).is_err());
            assert_eq!(read(directory, "Artist").unwrap(), original);
        }
        assert_eq!(std::fs::read_dir(directory).unwrap().count(), 1);
    }

    #[test]
    fn names_are_exact_and_cannot_escape_the_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let directory = temporary.path();
        let escaped = path(directory, "../../Artist").unwrap();
        assert_eq!(escaped.parent(), Some(directory));
        assert_ne!(
            path(directory, "Artist").unwrap(),
            path(directory, "artist").unwrap()
        );
        assert_ne!(
            path(directory, "A feat. B").unwrap(),
            path(directory, "A").unwrap()
        );
        assert!(path(directory, " ").is_err());
        assert!(read(directory, "").is_err());
    }

    #[test]
    fn reports_storage_failures_without_replacing_existing_data() {
        let temporary = tempfile::tempdir().unwrap();
        let directory = temporary.path();
        let destination = path(directory, "Artist").unwrap();
        std::fs::create_dir(&destination).unwrap();
        assert!(read(directory, "Artist").is_err());
        assert!(save(directory, "Artist", &picture([255, 0, 0])).is_err());
        assert!(destination.is_dir());
        assert_eq!(std::fs::read_dir(directory).unwrap().count(), 1);
    }
}
