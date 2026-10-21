use serde_json::Value;

pub(crate) fn convert(value: &mut Value) -> Result<bool, String> {
    let Some(object) = value.as_object_mut() else {
        return Ok(false);
    };
    let Some(previous) = object.remove("monitoringFolders") else {
        return Ok(false);
    };
    let previous = previous.as_array().ok_or("旧同步配置必须是数组")?;
    let folders = object
        .entry("synchronizationFolders")
        .or_insert_with(|| Value::Array(Vec::new()));
    let folders = folders.as_array_mut().ok_or("同步配置必须是数组")?;
    for folder in previous {
        if !folders
            .iter()
            .any(|current| current.get("path") == folder.get("path"))
        {
            folders.push(folder.clone());
        }
    }
    Ok(true)
}
