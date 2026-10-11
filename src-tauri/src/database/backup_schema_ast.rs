use serde_json::{json, Value};
use sqlite3_parser::{
    ast::{Cmd, Stmt},
    lexer::sql::Parser,
    Bump, FallibleIterator,
};

pub(super) fn definition(sql: &str) -> Result<Value, String> {
    let bump = Bump::new();
    let mut parser = Parser::new(&bump, sql.as_bytes());
    let command = parser
        .next()
        .map_err(|error| error.to_string())?
        .ok_or("缺少结构定义")?;
    if !matches!(
        &command,
        Cmd::Stmt(Stmt::CreateTable { .. } | Stmt::CreateIndex { .. } | Stmt::CreateTrigger { .. })
    ) {
        return Err("未支持的结构定义".into());
    }
    if parser.next().map_err(|error| error.to_string())?.is_some() {
        return Err("结构定义包含多个语句".into());
    }
    let mut tree = serde_json::to_value(command).map_err(|error| error.to_string())?;
    normalize(&mut tree, None)?;
    let statement = tree.get("Stmt").ok_or("结构 AST 无效")?;
    if let Some(table) = statement.get("CreateTable") {
        return table_constraints(table);
    }
    if let Some(index) = statement.get("CreateIndex") {
        let mut expressions = Vec::new();
        for column in array(index, "columns")? {
            let mut expr = column.get("expr").ok_or("索引 AST 无效")?;
            // The effective outer collation and sort direction come from index_xinfo.
            while let Some(parts) = expr.get("Collate").and_then(Value::as_array) {
                expr = parts.first().ok_or("索引 AST 无效")?;
            }
            expressions.push(expr.clone());
        }
        return Ok(json!({"expressions": expressions, "where": index.get("where_clause")}));
    }
    Ok(tree)
}

fn array<'a>(value: &'a Value, key: &str) -> Result<&'a [Value], String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| format!("结构 AST 字段无效：{key}"))
}

fn deferred(value: &Value) -> Result<bool, String> {
    if value.is_null() {
        return Ok(false);
    }
    let deferrable = value
        .get("deferrable")
        .and_then(Value::as_bool)
        .ok_or("外键延迟 AST 无效")?;
    let initially = value.get("init_deferred").ok_or("外键延迟 AST 无效")?;
    Ok(deferrable && initially == "InitiallyDeferred")
}

fn foreign_key(columns: Vec<Value>, value: &Value) -> Result<Value, String> {
    let clause = value.get("clause").ok_or("外键 AST 无效")?;
    let mut actions = serde_json::Map::new();
    actions.insert("OnDelete".into(), json!("NoAction"));
    actions.insert("OnUpdate".into(), json!("NoAction"));
    for arg in array(clause, "args")? {
        let object = arg.as_object().ok_or("外键动作 AST 无效")?;
        for (key, action) in object {
            actions.insert(key.clone(), action.clone());
        }
    }
    let targets: Vec<Value> = match clause.get("columns") {
        Some(Value::Array(targets)) => targets
            .iter()
            .map(|column| column["col_name"].clone())
            .collect(),
        Some(Value::Null) => Vec::new(),
        _ => return Err("外键列 AST 无效".into()),
    };
    Ok(
        json!({"columns": columns, "table": clause["tbl_name"], "targets": targets,
        "actions": actions, "deferred": deferred(&value["defer_clause"])?}),
    )
}

fn key_columns(value: &Value) -> Result<Vec<Value>, String> {
    array(value, "columns")?
        .iter()
        .map(|column| {
            let mut expr = column.get("expr").ok_or("键列 AST 无效")?;
            while let Some(parts) = expr.get("Collate").and_then(Value::as_array) {
                expr = parts.first().ok_or("键列 AST 无效")?;
            }
            if let Some(name) = expr.get("Id").or_else(|| expr.get("Name")) {
                return Ok(name.clone());
            }
            // SQLite also accepts single-quoted identifiers in table key declarations.
            if let Some(name) = expr
                .get("Literal")
                .and_then(|literal| literal.get("String"))
                .and_then(Value::as_str)
            {
                return Ok(json!(identifier(name)?));
            }
            Err("未支持的表键表达式".into())
        })
        .collect()
}

fn conflict(value: &Value) -> Value {
    value
        .get("conflict_clause")
        .cloned()
        .unwrap_or_else(|| json!("Abort"))
}

// PRAGMA supplies column types/nullability, table flags, key ordering, effective
// index collations and rowid-alias identity (an INTEGER alias has no PK index).
// AST supplies the enforcement details it does not expose. Declarative constraints
// are independent of inline/table placement and their generated index names.
fn table_constraints(table: &Value) -> Result<Value, String> {
    let body = table
        .get("body")
        .and_then(|body| body.get("ColumnsAndConstraints"))
        .ok_or("未支持的表定义")?;
    let mut details = Vec::new();
    let mut checks = Vec::new();
    let mut foreign_keys = Vec::new();
    let mut last_foreign = None;
    for column in array(body, "columns")? {
        let name = column.get("col_name").ok_or("列 AST 无效")?;
        let mut collation = json!("binary");
        let mut default = Value::Null;
        for named in array(column, "constraints")? {
            let constraint = named
                .get("constraint")
                .and_then(Value::as_object)
                .ok_or("列约束 AST 无效")?;
            for (kind, value) in constraint {
                match kind.as_str() {
                    "PrimaryKey" => details.push(json!({"PrimaryKey": {"columns": [name], "conflict": conflict(value), "autoincrement": value["auto_increment"]}})),
                    "Unique" => details.push(json!({"Unique": {"columns": [name], "conflict": value}})),
                    "NotNull" => {
                        if value["nullable"] == false && conflict(value) != "Abort" {
                            details.push(json!({"NotNull": {"column": name, "conflict": conflict(value)}}));
                        }
                    }
                    "Check" => checks.push(json!({"expression": value, "conflict": "Abort"})),
                    "Default" => default = value.clone(),
                    "Collate" => collation = value["collation_name"].clone(),
                    "ForeignKey" => {
                        foreign_keys.push(foreign_key(vec![name.clone()], value)?);
                        last_foreign = Some(foreign_keys.len() - 1);
                    }
                    "Defer" => {
                        // sqlite3-parser emits column DEFERRABLE as a separate node;
                        // SQLite applies it to the most recently declared foreign key.
                        let index = last_foreign.ok_or("没有对应外键的延迟声明")?;
                        foreign_keys[index]["deferred"] = json!(deferred(value)?);
                    }
                    "Generated" => details.push(json!({"Generated": {"column": name, "definition": value}})),
                    _ => return Err(format!("未支持的列约束：{kind}")),
                }
            }
        }
        if collation != "binary" {
            details.push(json!({"Collation": {"column": name, "name": collation}}));
        }
        if !default.is_null() && default != json!({"Literal": "Null"}) {
            details.push(json!({"Default": {"column": name, "expression": default}}));
        }
    }
    if let Some(Value::Array(constraints)) = body.get("constraints") {
        for named in constraints {
            let constraint = named
                .get("constraint")
                .and_then(Value::as_object)
                .ok_or("表约束 AST 无效")?;
            for (kind, value) in constraint {
                match kind.as_str() {
                    "PrimaryKey" => details.push(json!({"PrimaryKey": {"columns": key_columns(value)?, "conflict": conflict(value), "autoincrement": value["auto_increment"]}})),
                    "Unique" => details.push(json!({"Unique": {"columns": key_columns(value)?, "conflict": conflict(value)}})),
                    "Check" => {
                        let parts = value.as_array().ok_or("CHECK AST 无效")?;
                        if parts.len() != 2 { return Err("CHECK AST 无效".into()); }
                        checks.push(json!({"expression": parts[0], "conflict": if parts[1].is_null() { json!("Abort") } else { parts[1].clone() }}));
                    }
                    "ForeignKey" => {
                        let columns = array(value, "columns")?.iter().map(|column| column["col_name"].clone()).collect();
                        foreign_keys.push(foreign_key(columns, value)?);
                    }
                    _ => return Err(format!("未支持的表约束：{kind}")),
                }
            }
        }
    }
    // These are serialized AST keys for stable ordering, never normalized SQL.
    details.sort_by_cached_key(Value::to_string);
    foreign_keys.sort_by_cached_key(Value::to_string);
    // Do not reorder checks whose evaluation may involve functions or subqueries.
    if !checks.iter().any(order_sensitive) {
        checks.sort_by_cached_key(Value::to_string);
    }
    Ok(json!({"constraints": details, "checks": checks, "foreign_keys": foreign_keys}))
}

fn order_sensitive(value: &Value) -> bool {
    match value {
        Value::Object(fields) => fields.iter().any(|(key, child)| {
            matches!(
                key.as_str(),
                "FunctionCall" | "FunctionCallStar" | "Subquery" | "Exists" | "Raise" | "Variable"
            ) || order_sensitive(child)
        }),
        Value::Array(items) => items.iter().any(order_sensitive),
        _ => false,
    }
}

// Work on the parsed tree, not SQL text or pretty-printed tokens. In particular,
// operators, nesting, string constants and trigger command order remain distinct.
fn normalize(tree: &mut Value, field: Option<&str>) -> Result<(), String> {
    match tree {
        Value::String(value)
            if matches!(
                field,
                Some(
                    "name"
                        | "col_name"
                        | "collation_name"
                        | "db_name"
                        | "alias"
                        | "tbl_name"
                        | "idx_name"
                        | "trigger_name"
                        | "Id"
                        | "Name"
                )
            ) =>
        {
            *value = identifier(value)?;
        }
        Value::Array(items) => {
            for item in items {
                normalize(item, field)?;
            }
        }
        Value::Object(fields) => {
            // A single parenthesized expression has the exact same tree meaning.
            if fields.len() == 1 {
                if let Some(Value::Array(items)) = fields.get_mut("Parenthesized") {
                    if items.len() == 1 {
                        *tree = items.remove(0);
                        return normalize(tree, None);
                    }
                }
            }
            if fields.contains_key("constraint") {
                // Constraint names do not affect enforcement.
                fields.remove("name");
            }
            for variant in ["PrimaryKey", "NotNull", "Unique"] {
                if let Some(Value::Object(constraint)) = fields.get_mut(variant) {
                    if let Some(conflict) = constraint.get_mut("conflict_clause") {
                        if conflict.is_null() {
                            *conflict = Value::String("Abort".into());
                        }
                    }
                }
            }
            for (key, child) in fields.iter_mut() {
                match key.as_str() {
                    "if_not_exists" => *child = Value::Bool(false),
                    "for_each_row" => *child = Value::Bool(true),
                    "time" if child.is_null() => *child = Value::String("Before".into()),
                    "order" if child.is_null() => *child = Value::String("Asc".into()),
                    "Unique" if child.is_null() => *child = Value::String("Abort".into()),
                    "Default" => {
                        protect_default_literals(child);
                        normalize(child, None)?;
                    }
                    "Qualified" | "DoublyQualified" | "UpdateOf" => normalize(child, Some("Name"))?,
                    "Collate" if child.is_array() => {
                        let parts = child.as_array_mut().ok_or("排序规则 AST 无效")?;
                        if parts.len() != 2 {
                            return Err("排序规则 AST 无效".into());
                        }
                        normalize(&mut parts[0], None)?;
                        normalize(&mut parts[1], Some("Name"))?;
                    }
                    _ => normalize(child, Some(key))?,
                }
            }
        }
        _ => {}
    }
    Ok(())
}

// SQLite accepts identifier tokens as case-sensitive string constants in DEFAULT.
// They must not be confused with bound column/function identifiers. Keep their
// representation unless they are unquoted TRUE/FALSE boolean keywords.
fn protect_default_literals(tree: &mut Value) {
    match tree {
        Value::Object(fields) => {
            if let Some(Value::String(value)) = fields.remove("Id") {
                let value =
                    if value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false") {
                        value.to_ascii_lowercase()
                    } else {
                        value
                    };
                fields.insert("DefaultIdLiteral".into(), Value::String(value));
            } else {
                for child in fields.values_mut() {
                    protect_default_literals(child);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                protect_default_literals(item);
            }
        }
        _ => {}
    }
}

// Decode a *parsed identifier* with SQLite's quote escaping and ASCII-only case
// rules. Never apply this to string literals, numeric literals or entire SQL.
fn identifier(value: &str) -> Result<String, String> {
    let Some(first) = value.as_bytes().first().copied() else {
        return Ok(String::new());
    };
    let closing = match first {
        b'"' | b'`' | b'\'' => first,
        b'[' => b']',
        _ => return Ok(value.to_ascii_lowercase()),
    };
    if value.len() < 2 || value.as_bytes().last() != Some(&closing) {
        return Err("标识符引用无效".into());
    }
    let contents = &value[1..value.len() - 1];
    let contents = if first == b'[' {
        contents.to_owned()
    } else {
        let quote = char::from(closing);
        contents.replace(&format!("{quote}{quote}"), &quote.to_string())
    };
    Ok(contents.to_ascii_lowercase())
}
