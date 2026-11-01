use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
pub enum Name {
    Playing,
    Library,
    Playlist,
    Inbox,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Page {
    pub name: Name,
    pub enabled: bool,
}

pub fn defaults() -> Vec<Page> {
    [Name::Playing, Name::Library, Name::Playlist, Name::Inbox]
        .into_iter()
        .map(|name| Page {
            name,
            enabled: true,
        })
        .collect()
}

pub(super) fn validate(pages: &[Page]) -> Result<(), String> {
    let names: std::collections::HashSet<_> = pages.iter().map(|page| page.name).collect();
    if pages.len() != 4 || names.len() != 4 {
        return Err("页面列表必须包含四个不同的页面".to_owned());
    }
    if !pages
        .iter()
        .any(|page| page.name == Name::Library && page.enabled)
    {
        return Err("音乐库不可禁用".to_owned());
    }
    Ok(())
}

pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<Page>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let pages = Vec::<Page>::deserialize(deserializer)?;
    validate(&pages).map_err(serde::de::Error::custom)?;
    Ok(pages)
}
