use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Mode {
    Startup,
    Continuous,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Folder {
    pub(crate) path: String,
    pub(crate) mode: Mode,
    #[serde(default = "default_enabled")]
    pub(crate) enabled: bool,
}

fn default_enabled() -> bool {
    true
}

pub(crate) fn normalize(folders: &mut [Folder], previous: &[Folder]) -> Result<(), String> {
    for folder in folders.iter_mut() {
        if !previous.iter().any(|saved| saved.path == folder.path) {
            let path = std::fs::canonicalize(&folder.path)
                .map_err(|error| format!("无法访问监视文件夹 {}: {error}", folder.path))?;
            if !path.is_dir() {
                return Err("监视路径必须是文件夹".into());
            }
            folder.path = path.to_string_lossy().into_owned();
        }
        if !Path::new(&folder.path).is_absolute() {
            return Err("监视路径必须是绝对路径".into());
        }
    }
    for (index, folder) in folders.iter().enumerate() {
        let path = Path::new(&folder.path);
        if folders[..index]
            .iter()
            .any(|other| path.starts_with(&other.path) || Path::new(&other.path).starts_with(path))
        {
            return Err("监视文件夹不能重复或相互嵌套".into());
        }
    }
    Ok(())
}
