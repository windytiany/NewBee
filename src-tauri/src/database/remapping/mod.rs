use super::Database;
use crate::remapping::prefix::{normalize_windows_path, Prefix};
use rusqlite::{params, Transaction};
use std::collections::HashSet;

fn remap_table(
    transaction: &Transaction<'_>,
    table: &str,
    id_column: &str,
    path_column: &str,
    unique: bool,
    prefix: &Prefix,
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
        if let Some(target) = prefix.replace(path) {
            changes.push((*id, target));
        } else {
            final_paths.insert(normalize_windows_path(path));
        }
    }
    if unique {
        for (_, target) in &changes {
            if !final_paths.insert(target.clone()) {
                return Err(format!("重映射后路径冲突，未修改任何路径：{target}"));
            }
        }
    }
    let mut reserved_paths = final_paths;
    reserved_paths.extend(paths.into_iter().map(|(_, path)| path));
    let mut update = transaction
        .prepare(&format!(
            "UPDATE {table} SET {path_column} = ?1 WHERE {id_column} = ?2"
        ))
        .map_err(|error| format!("无法准备路径重映射：{error}"))?;
    if unique {
        for (id, _) in &changes {
            let mut temporary = format!("newbee:path-remapping:{id}");
            while !reserved_paths.insert(temporary.clone()) {
                temporary.push('#');
            }
            update
                .execute(params![temporary, id])
                .map_err(|error| format!("路径重映射失败，已回滚：{error}"))?;
        }
    }
    for (id, path) in &changes {
        update
            .execute(params![path, id])
            .map_err(|error| format!("路径重映射失败，已回滚：{error}"))?;
    }
    Ok(changes.len())
}

impl Database {
    #[cfg(test)]
    pub fn remap_paths(&self, old_path: &str, new_path: &str) -> Result<usize, String> {
        self.remap_paths_with(old_path, new_path, || Ok(()))
    }

    pub(crate) fn remap_paths_with(
        &self,
        old_path: &str,
        new_path: &str,
        persist: impl FnOnce() -> Result<(), String>,
    ) -> Result<usize, String> {
        let prefix = Prefix::new(old_path, new_path)?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始路径重映射：{error}"))?;
        let mut count = 0;
        for (table, id, path, unique) in [
            ("tracks", "id", "path", true),
            ("track_artwork_sources", "id", "source_path", false),
        ] {
            count += remap_table(&transaction, table, id, path, unique, &prefix)?;
        }
        persist()?;
        transaction
            .commit()
            .map_err(|error| format!("无法保存路径重映射：{error}"))?;
        Ok(count)
    }
}
