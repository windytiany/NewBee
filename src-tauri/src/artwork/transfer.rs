use image::ImageFormat;
use std::path::Path;
use tauri::ipc::Response;

#[tauri::command]
pub(crate) async fn has_clipboard_artwork() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| super::clipboard::read().map(|data| !data.is_empty()))
        .await
        .map_err(|error| format!("读取剪贴板失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn read_clipboard_artwork() -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(|| super::clipboard::read().map(Response::new))
        .await
        .map_err(|error| format!("读取剪贴板失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn artwork_extensions(data: Vec<u8>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        image::guess_format(&data)
            .map(|format| {
                format
                    .extensions_str()
                    .iter()
                    .map(|ext| (*ext).to_owned())
                    .collect()
            })
            .map_err(|error| format!("识别封面格式失败：{error}"))
    })
    .await
    .map_err(|error| format!("识别封面格式失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn save_artwork(path: String, data: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save(Path::new(&path), &data))
        .await
        .map_err(|error| format!("保存封面失败：{error}"))?
}

fn save(path: &Path, data: &[u8]) -> Result<(), String> {
    let format = image::guess_format(data).map_err(|error| format!("识别封面格式失败：{error}"))?;
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .and_then(ImageFormat::from_extension)
        != Some(format)
    {
        return Err("文件扩展名与封面格式不匹配。".into());
    }
    std::fs::write(path, data).map_err(|error| format!("保存封面失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn picture(format: ImageFormat) -> Vec<u8> {
        let mut data = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(7, 5)
            .write_to(&mut data, format)
            .unwrap();
        data.into_inner()
    }

    #[test]
    fn export_preserves_encoded_bytes_and_dimensions() {
        for format in [ImageFormat::Png, ImageFormat::Jpeg, ImageFormat::WebP] {
            let data = picture(format);
            let path = std::env::temp_dir().join(format!(
                "newbee-cover-{}.{}",
                std::process::id(),
                format.extensions_str()[0]
            ));
            save(&path, &data).unwrap();
            let saved = std::fs::read(&path).unwrap();
            std::fs::remove_file(path).unwrap();
            assert_eq!(saved, data);
            let decoded = image::load_from_memory(&saved).unwrap();
            assert_eq!((decoded.width(), decoded.height()), (7, 5));
        }
    }

    #[test]
    fn rejects_mismatched_extensions_without_writing() {
        let path =
            std::env::temp_dir().join(format!("newbee-cover-mismatch-{}.jpg", std::process::id()));
        std::fs::write(&path, b"existing content").unwrap();
        assert!(save(&path, &picture(ImageFormat::Png)).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"existing content");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn export_commands_use_detected_formats_and_report_write_failures() {
        let data = picture(ImageFormat::Jpeg);
        let extensions = tauri::async_runtime::block_on(artwork_extensions(data.clone())).unwrap();
        assert_eq!(extensions, ["jpg", "jpeg"]);
        let path =
            std::env::temp_dir().join(format!("newbee-cover-command-{}.jpg", std::process::id()));
        tauri::async_runtime::block_on(save_artwork(
            path.to_string_lossy().into_owned(),
            data.clone(),
        ))
        .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), data);
        std::fs::remove_file(&path).unwrap();
        let missing_directory = path.join("cover.jpg");
        assert!(tauri::async_runtime::block_on(save_artwork(
            missing_directory.to_string_lossy().into_owned(),
            data
        ))
        .is_err());
        assert!(tauri::async_runtime::block_on(artwork_extensions(vec![1, 2, 3])).is_err());
    }
}
