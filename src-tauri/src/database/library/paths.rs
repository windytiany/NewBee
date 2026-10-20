use super::super::Database;
use rusqlite::{params, Transaction};
use std::collections::HashSet;

fn normalize_prefix(path: &str) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() || path.contains('\0') {
        return Err("路径不能为空或包含空字符".to_owned());
    }
    let path = normalize_windows_path(path);
    let separator = if path.starts_with(r"\\") { '\\' } else { '/' };
    Ok(path.trim_end_matches(separator).to_owned())
}

// Normalize lexically: neither location needs to exist, or use the host OS format.
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

fn replace_directory(path: &str, old: &str, new: &str) -> Option<String> {
    let path = normalize_windows_path(path);
    let suffix = path.strip_prefix(old)?;
    let source_separator = if old.starts_with(r"\\") { '\\' } else { '/' };
    if !suffix.is_empty() && !suffix.starts_with(source_separator) {
        return None;
    }
    let target_separator = if new.starts_with(r"\\") { '\\' } else { '/' };
    let suffix = suffix.replace(source_separator, &target_separator.to_string());
    Some(if new.is_empty() && suffix.is_empty() {
        "/".to_owned()
    } else {
        format!("{new}{suffix}")
    })
}

fn migrate_table(
    transaction: &Transaction<'_>,
    table: &str,
    id_column: &str,
    path_column: &str,
    unique: bool,
    old: &str,
    new: &str,
) -> Result<usize, String> {
    let paths = {
        let mut statement = transaction
            .prepare(&format!(
                "SELECT {id_column}, {path_column} FROM {table} ORDER BY {id_column}"
            ))
            .map_err(|error| format!("无法读取路径：{error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| format!("无法读取路径：{error}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("无法读取路径：{error}"))?
    };
    let mut final_paths = HashSet::new();
    let mut changes = Vec::new();
    for (id, path) in &paths {
        if let Some(target) = replace_directory(path, old, new) {
            changes.push((*id, target));
        } else {
            final_paths.insert(normalize_windows_path(path));
        }
    }
    if unique {
        for (_, target) in &changes {
            if !final_paths.insert(target.clone()) {
                return Err(format!("迁移后路径冲突，未修改任何路径：{target}"));
            }
        }
    }
    let mut reserved_paths = final_paths;
    reserved_paths.extend(paths.into_iter().map(|(_, path)| path));
    let mut update = transaction
        .prepare(&format!(
            "UPDATE {table} SET {path_column} = ?1 WHERE {id_column} = ?2"
        ))
        .map_err(|error| format!("无法准备路径迁移：{error}"))?;
    // Stage unique paths so overlapping locations never cause transient collisions.
    if unique {
        for (id, _) in &changes {
            let mut temporary = format!("newbee:path-migration:{id}");
            while !reserved_paths.insert(temporary.clone()) {
                temporary.push('#');
            }
            update
                .execute(params![temporary, id])
                .map_err(|error| format!("路径迁移失败，已回滚：{error}"))?;
        }
    }
    for (id, path) in &changes {
        update
            .execute(params![path, id])
            .map_err(|error| format!("路径迁移失败，已回滚：{error}"))?;
    }
    Ok(changes.len())
}

impl Database {
    pub fn migrate_library_paths(&self, old_path: &str, new_path: &str) -> Result<usize, String> {
        let old_path = normalize_prefix(old_path)?;
        let new_path = normalize_prefix(new_path)?;
        if old_path == new_path {
            return Err("原路径与新路径不能相同".to_owned());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始路径迁移：{error}"))?;
        let mut count = 0;
        for (table, id, path, unique) in [
            ("tracks", "id", "path", true),
            ("music_library_directories", "id", "path", true),
            ("track_artwork_sources", "id", "source_path", false),
        ] {
            count += migrate_table(&transaction, table, id, path, unique, &old_path, &new_path)?;
        }
        transaction
            .commit()
            .map_err(|error| format!("无法保存路径迁移：{error}"))?;
        Ok(count)
    }
}
