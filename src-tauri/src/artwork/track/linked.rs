use crate::artwork::model::ArtworkContent;

pub(crate) fn normalize(path: &str) -> Result<String, String> {
    let path = std::path::Path::new(path);
    if !path.is_absolute() {
        return Err("关联图片必须使用绝对路径".into());
    }
    let path =
        std::path::absolute(path).map_err(|error| format!("读取关联图片路径失败：{error}"))?;
    let path = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        let path = path.replace('/', "\\");
        let path = if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{unc}")
        } else {
            path.strip_prefix(r"\\?\").unwrap_or(&path).to_owned()
        };
        Ok(path.to_ascii_lowercase())
    }
    #[cfg(not(windows))]
    {
        Ok(path)
    }
}

pub(crate) fn decode(data: Vec<u8>) -> Result<ArtworkContent, String> {
    let picture = crate::metadata::files::cover_picture(&data)?;
    Ok(ArtworkContent {
        mime_type: picture
            .mime_type()
            .map(ToString::to_string)
            .unwrap_or_default(),
        image: data,
    })
}

pub(crate) fn read(path: &str) -> Result<ArtworkContent, String> {
    let data = std::fs::read(path).map_err(|error| format!("读取关联图片失败 {path}: {error}"))?;
    decode(data)
}

#[tauri::command]
pub(crate) async fn read_artwork_file(path: String) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read(&normalize(&path)?).map(|content| content.image)
    })
    .await
    .map_err(|error| format!("读取图片任务失败：{error}"))?
}
