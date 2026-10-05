use super::Database;
use rusqlite::params;
use std::collections::HashSet;

// Scanning stores canonical Windows paths, while users usually enter display paths.
// Normalize lexically: neither the old nor the new location needs to exist yet.
fn normalize_prefix(path: &str) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() || path.contains('\0') {
        return Err("路径不能为空或包含空字符".to_owned());
    }
    Ok(normalize_windows_path(path))
}

fn normalize_windows_path(path: &str) -> String {
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
    path.to_owned()
}

impl Database {
    pub fn migrate_track_paths(&self, old_path: &str, new_path: &str) -> Result<usize, String> {
        let old_path = normalize_prefix(old_path)?;
        let new_path = normalize_prefix(new_path)?;
        if old_path == new_path {
            return Err("原路径与新路径不能相同".to_owned());
        }

        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始路径迁移：{error}"))?;
        let tracks = {
            let mut statement = transaction
                .prepare("SELECT id, path FROM tracks ORDER BY id")
                .map_err(|error| format!("无法读取曲目路径：{error}"))?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|error| format!("无法读取曲目路径：{error}"))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|error| format!("无法读取曲目路径：{error}"))?
        };

        let mut final_paths = HashSet::new();
        let mut changes = Vec::new();
        for (id, path) in &tracks {
            let normalized = normalize_windows_path(path);
            if let Some(suffix) = normalized.strip_prefix(&old_path) {
                changes.push((*id, format!("{new_path}{suffix}")));
            } else {
                final_paths.insert(normalized);
            }
        }
        for (_, target) in &changes {
            if !final_paths.insert(target.clone()) {
                return Err(format!("迁移后路径冲突，未修改任何曲目：{target}"));
            }
        }

        // Stage paths inside the transaction so overlapping source/destination
        // prefixes do not cause transient UNIQUE violations. Never change IDs.
        let mut reserved_paths = final_paths;
        reserved_paths.extend(tracks.into_iter().map(|(_, path)| path));
        {
            let mut update = transaction
                .prepare("UPDATE tracks SET path = ?1 WHERE id = ?2")
                .map_err(|error| format!("无法准备路径迁移：{error}"))?;
            for (id, _) in &changes {
                let mut temporary = format!("newbee:path-migration:{id}");
                while !reserved_paths.insert(temporary.clone()) {
                    temporary.push('#');
                }
                update
                    .execute(params![temporary, id])
                    .map_err(|error| format!("路径迁移失败，已回滚：{error}"))?;
            }
            for (id, path) in &changes {
                update
                    .execute(params![path, id])
                    .map_err(|error| format!("路径迁移失败，已回滚：{error}"))?;
            }
        }
        transaction
            .commit()
            .map_err(|error| format!("无法保存路径迁移：{error}"))?;
        Ok(changes.len())
    }
}

#[cfg(test)]
#[path = "tests/paths.rs"]
mod tests;
