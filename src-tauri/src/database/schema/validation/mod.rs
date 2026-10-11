use rusqlite::{types::Value as SqlValue, Connection};
use serde_json::Value;
use std::collections::BTreeMap;

mod ast;

const INCOMPATIBLE: &str = "备份数据库与当前版本不兼容";

type Metadata = Vec<Vec<SqlValue>>;

#[derive(Debug, PartialEq)]
struct Index {
    name: Option<String>,
    unique: SqlValue,
    origin: SqlValue,
    partial: SqlValue,
    columns: Metadata,
}

#[derive(Debug, PartialEq)]
struct Schema {
    objects: BTreeMap<(String, String, String), Value>,
    tables: Metadata,
    columns: BTreeMap<String, Metadata>,
    foreign_keys: BTreeMap<String, Vec<Metadata>>,
    indexes: BTreeMap<String, Vec<Index>>,
}

pub(in crate::database) fn validate(
    actual: &Connection,
    expected: &Connection,
) -> Result<(), String> {
    let actual = describe(actual)?;
    let expected = describe(expected)?;
    if actual != expected {
        return Err(INCOMPATIBLE.into());
    }
    Ok(())
}

fn metadata(connection: &Connection, sql: &str, parameter: &str) -> Result<Metadata, String> {
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let count = statement.column_count();
    let rows = statement
        .query_map([parameter], |row| {
            (0..count)
                .map(|index| {
                    let value = row.get::<_, SqlValue>(index)?;
                    Ok(match value {
                        SqlValue::Text(text) => SqlValue::Text(text.to_ascii_lowercase()),
                        other => other,
                    })
                })
                .collect()
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<_>>()
        .map_err(|error| error.to_string())
}

fn describe(connection: &Connection) -> Result<Schema, String> {
    let mut schema = Schema {
        objects: BTreeMap::new(),
        tables: metadata(connection,
            "SELECT name, type, ncol, wr, strict FROM pragma_table_list WHERE schema = 'main' AND substr(lower(name), 1, 7) != 'sqlite_' AND lower(name) != ?1 ORDER BY lower(name)",
            "newbee_backup_manifest")?,
        columns: BTreeMap::new(), foreign_keys: BTreeMap::new(), indexes: BTreeMap::new(),
    };
    let mut statement = connection.prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE substr(lower(name), 1, 7) != 'sqlite_' AND lower(name) != 'newbee_backup_manifest' ORDER BY type, lower(name)"
    ).map_err(|error| error.to_string())?;
    let objects = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for object in objects {
        let (kind, name, table, sql) = object.map_err(|error| error.to_string())?;
        let sql = sql.ok_or_else(|| format!("{INCOMPATIBLE}：结构对象缺少定义"))?;
        let definition = ast::definition(&sql)
            .map_err(|error| format!("{INCOMPATIBLE}：无法校验 {name}：{error}"))?;
        let key = (
            kind.clone(),
            name.to_ascii_lowercase(),
            table.to_ascii_lowercase(),
        );
        if schema.objects.insert(key, definition).is_some() {
            return Err(format!("{INCOMPATIBLE}：结构对象重复"));
        }
        if kind != "table" {
            continue;
        }
        let columns = metadata(connection,
            // DEFAULT is compared as an expression AST, never as PRAGMA's SQL text.
            "SELECT cid, name, type, \"notnull\", pk, hidden FROM pragma_table_xinfo(?1) ORDER BY cid", &name)?;
        let foreign_keys = metadata(connection,
            "SELECT id, seq, \"table\", \"from\", \"to\", on_update, on_delete, match FROM pragma_foreign_key_list(?1) ORDER BY id, seq", &name)?;
        // Include SQLite's implicit UNIQUE and PRIMARY KEY indexes, not just named indexes.
        let indexes = metadata(connection,
            "SELECT name, \"unique\", origin, partial FROM pragma_index_list(?1) ORDER BY lower(name)", &name)?;
        let mut descriptions = Vec::new();
        for index in &indexes {
            let Some(SqlValue::Text(index_name)) = index.first() else {
                return Err(format!("{INCOMPATIBLE}：索引元数据无效"));
            };
            descriptions.push(Index {
                // Autoindex names encode declaration order, not index semantics.
                name: if index[2] == SqlValue::Text("c".into()) { Some(index_name.clone()) } else { None },
                unique: index[1].clone(), origin: index[2].clone(), partial: index[3].clone(),
                columns: metadata(connection,
                    "SELECT seqno, cid, name, desc, coll, key FROM pragma_index_xinfo(?1) ORDER BY seqno", index_name)?,
            });
        }
        let name = name.to_ascii_lowercase();
        schema.columns.insert(name.clone(), columns);
        let mut groups = BTreeMap::new();
        for mut row in foreign_keys {
            let SqlValue::Integer(id) = row.remove(0) else {
                return Err("外键元数据无效".into());
            };
            groups.entry(id).or_insert_with(Vec::new).push(row);
        }
        let mut foreign_keys: Vec<Metadata> = groups.into_values().collect();
        // Sort structured metadata only; retain composite-key column order inside each group.
        foreign_keys.sort_by_cached_key(|group| format!("{group:?}"));
        descriptions.sort_by_cached_key(|index| format!("{index:?}"));
        schema.foreign_keys.insert(name.clone(), foreign_keys);
        schema.indexes.insert(name, descriptions);
    }
    Ok(schema)
}
