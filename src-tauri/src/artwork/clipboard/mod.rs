#[cfg(windows)]
mod windows;
use image::{codecs::bmp::BmpDecoder, DynamicImage, ImageDecoder, ImageFormat, Limits};
use std::{
    io::{Cursor, Read},
    path::PathBuf,
};

const MAX_COVER_BYTES: usize = 20 * 1024 * 1024;

enum ClipboardImage {
    Empty,
    File(PathBuf),
    Encoded(Vec<u8>),
    Bitmap(Vec<u8>),
}

pub(super) fn read() -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    let source = windows::read()?;
    #[cfg(not(windows))]
    let source = ClipboardImage::Empty;
    materialize(source)
}

fn materialize(source: ClipboardImage) -> Result<Vec<u8>, String> {
    let data = match source {
        ClipboardImage::Empty => return Ok(Vec::new()),
        ClipboardImage::File(path) => {
            let metadata = std::fs::metadata(&path)
                .map_err(|error| format!("读取剪贴板图片文件失败：{error}"))?;
            if !metadata.is_file() || metadata.len() == 0 {
                return Ok(Vec::new());
            }
            let file = std::fs::File::open(path)
                .map_err(|error| format!("读取剪贴板图片文件失败：{error}"))?;
            let mut data = Vec::new();
            file.take((MAX_COVER_BYTES + 1) as u64)
                .read_to_end(&mut data)
                .map_err(|error| format!("读取剪贴板图片文件失败：{error}"))?;
            data
        }
        ClipboardImage::Encoded(data) => data,
        ClipboardImage::Bitmap(data) => {
            let mut decoder = BmpDecoder::new_without_file_header(Cursor::new(data))
                .map_err(|error| format!("读取剪贴板图片失败：{error}"))?;
            decoder
                .set_limits(Limits::default())
                .map_err(|error| format!("读取剪贴板图片失败：{error}"))?;
            let image = DynamicImage::from_decoder(decoder)
                .map_err(|error| format!("读取剪贴板图片失败：{error}"))?;
            let mut output = Cursor::new(Vec::new());
            image
                .write_to(&mut output, ImageFormat::Png)
                .map_err(|error| format!("转换剪贴板图片失败：{error}"))?;
            output.into_inner()
        }
    };
    if validate_cover(&data)? {
        Ok(data)
    } else {
        Ok(Vec::new())
    }
}

fn validate_cover(data: &[u8]) -> Result<bool, String> {
    if data.is_empty() || data.len() > MAX_COVER_BYTES {
        return Err("封面为空或超过 20 MiB。".into());
    }
    if image::guess_format(data).is_err() {
        return Ok(false);
    }
    image::ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|error| format!("识别封面格式失败：{error}"))?
        .decode()
        .map(|_| true)
        .map_err(|error| format!("解码封面失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(format: ImageFormat) -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(8, 6)
            .write_to(&mut output, format)
            .unwrap();
        output.into_inner()
    }

    #[test]
    fn accepts_encoded_content_and_files_without_reencoding() {
        let data = picture(ImageFormat::Jpeg);
        assert_eq!(
            materialize(ClipboardImage::Encoded(data.clone())).unwrap(),
            data
        );
        let path =
            std::env::temp_dir().join(format!("newbee-clipboard-{}.jpg", std::process::id()));
        std::fs::write(&path, &data).unwrap();
        assert_eq!(
            materialize(ClipboardImage::File(path.clone())).unwrap(),
            data
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn converts_pixels_to_png_at_full_resolution() {
        let bmp = picture(ImageFormat::Bmp);
        let data = materialize(ClipboardImage::Bitmap(bmp[14..].to_vec())).unwrap();
        assert_eq!(image::guess_format(&data).unwrap(), ImageFormat::Png);
        let image = image::load_from_memory(&data).unwrap();
        assert_eq!((image.width(), image.height()), (8, 6));
    }

    #[test]
    fn rejects_empty_oversized_and_corrupt_encoded_images() {
        assert!(materialize(ClipboardImage::Encoded(Vec::new())).is_err());
        assert!(materialize(ClipboardImage::Encoded(vec![0; MAX_COVER_BYTES + 1])).is_err());
        assert!(materialize(ClipboardImage::Encoded(b"\x89PNG\r\n\x1a\n".to_vec())).is_err());
    }

    #[test]
    fn rejects_urls_non_images_corrupt_bitmaps_and_missing_files() {
        assert!(materialize(ClipboardImage::Empty).unwrap().is_empty());
        assert!(materialize(ClipboardImage::Encoded(
            b"https://example.com/image.jpg".to_vec()
        ))
        .unwrap()
        .is_empty());
        assert!(materialize(ClipboardImage::File(std::env::temp_dir()))
            .unwrap()
            .is_empty());
        assert!(materialize(ClipboardImage::Bitmap(vec![0; 40])).is_err());
        assert!(materialize(ClipboardImage::File(PathBuf::from(
            "missing-cover-file.jpg"
        )))
        .is_err());
    }
}
