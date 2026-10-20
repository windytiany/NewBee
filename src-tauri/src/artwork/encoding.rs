use image::{imageops::FilterType, DynamicImage, RgbaImage};
use std::io::Cursor;

pub(crate) const SIZES: [u32; 3] = [128, 512, 2048];

pub(crate) fn validate_size(size: Option<u32>) -> Result<(), String> {
    if size.is_some_and(|size| !SIZES.contains(&size)) {
        return Err("封面尺寸必须为 128、512 或 2048".into());
    }
    Ok(())
}

pub(crate) fn thumbnail(data: &[u8], size: u32) -> Result<Vec<u8>, String> {
    let image = image::ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|error| format!("识别封面格式失败：{error}"))?
        .decode()
        .map_err(|error| format!("解码封面失败：{error}"))?;
    let image = resize(image, size);
    let mut config = webp::WebPConfig::new().map_err(|_| "初始化封面编码器失败".to_owned())?;
    config.lossless = 0;
    config.quality = 85.0;
    config.method = 4;
    config.use_sharp_yuv = 1;
    config.alpha_quality = 100;
    webp::Encoder::from_rgba(image.as_raw(), image.width(), image.height())
        .encode_advanced(&config)
        .map(|output| output.to_vec())
        .map_err(|error| format!("生成封面缩略图失败：{error:?}"))
}

fn resize(image: DynamicImage, size: u32) -> RgbaImage {
    let width = size.min(image.width());
    let height = size.min(image.height());
    if !image.color().has_alpha() {
        return image.resize(width, height, FilterType::Lanczos3).to_rgba8();
    }
    // Resize premultiplied channels to prevent transparent RGB from bleeding
    // into visible edges. Sixteen bits preserve low-alpha colour precision.
    let mut image = image.to_rgba16();
    for pixel in image.pixels_mut() {
        for channel in 0..3 {
            pixel[channel] =
                ((u32::from(pixel[channel]) * u32::from(pixel[3]) + 32767) / 65535) as u16;
        }
    }
    let mut image = DynamicImage::ImageRgba16(image)
        .resize(width, height, FilterType::Lanczos3)
        .to_rgba16();
    for pixel in image.pixels_mut() {
        let alpha = u32::from(pixel[3]);
        for channel in 0..3 {
            pixel[channel] = (u32::from(pixel[channel]) * 65535 + alpha / 2)
                .checked_div(alpha)
                .unwrap_or(0)
                .min(65535) as u16;
        }
    }
    DynamicImage::ImageRgba16(image).to_rgba8()
}
