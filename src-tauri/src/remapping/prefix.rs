pub(crate) struct Prefix {
    old: String,
    new: String,
}

impl Prefix {
    pub(crate) fn new(old: &str, new: &str) -> Result<Self, String> {
        let old = normalize_prefix(old)?;
        let new = normalize_prefix(new)?;
        if old == new {
            return Err("原路径与新路径不能相同".into());
        }
        Ok(Self { old, new })
    }

    pub(crate) fn replace(&self, path: &str) -> Option<String> {
        let path = normalize_windows_path(path);
        let suffix = path.strip_prefix(&self.old)?;
        let source = if self.old.starts_with(r"\\") {
            '\\'
        } else {
            '/'
        };
        if !suffix.is_empty() && !suffix.starts_with(source) {
            return None;
        }
        let target = if self.new.starts_with(r"\\") {
            '\\'
        } else {
            '/'
        };
        let suffix = suffix.replace(source, &target.to_string());
        Some(if self.new.is_empty() && suffix.is_empty() {
            "/".into()
        } else {
            format!("{}{suffix}", self.new)
        })
    }
}

fn normalize_prefix(path: &str) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() || path.contains('\0') {
        return Err("路径不能为空或包含空字符".into());
    }
    let path = normalize_windows_path(path);
    let separator = if path.starts_with(r"\\") { '\\' } else { '/' };
    Ok(path.trim_end_matches(separator).into())
}

pub(crate) fn normalize_windows_path(path: &str) -> String {
    let bytes = path.as_bytes();
    let is_drive_path = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/');
    if is_drive_path || path.starts_with(r"\\") {
        let path = path.replace('/', r"\");
        if path.starts_with(r"\\?\") {
            return path;
        }
        if let Some(unc) = path.strip_prefix(r"\\") {
            return format!(r"\\?\UNC\{unc}");
        }
        return format!(r"\\?\{path}");
    }
    path.into()
}
