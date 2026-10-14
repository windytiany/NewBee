use super::{Draft, DraftPicture, Picture};
use crate::database::Database;
use serde::Deserialize;
use std::collections::HashSet;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TrackDraft {
    pub(crate) track_id: i64,
    pub(crate) pictures: Vec<PictureDraft>,
    pub(crate) display_index: Option<usize>,
}

#[derive(Deserialize)]
#[serde(tag = "source", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum PictureDraft {
    #[serde(rename_all = "camelCase")]
    Existing { artwork_id: i64, picture_type: u8 },
    #[serde(rename_all = "camelCase")]
    Embedded { data: Vec<u8>, picture_type: u8 },
    #[serde(rename_all = "camelCase")]
    Linked { path: String, picture_type: u8 },
}

pub(crate) struct Prepared {
    pub(crate) draft: Draft,
    pub(crate) pictures: Vec<Picture>,
    pub(crate) embedded_changed: bool,
}

pub(crate) fn prepare(database: &Database, request: TrackDraft) -> Result<Prepared, String> {
    if request
        .display_index
        .is_some_and(|index| index >= request.pictures.len())
    {
        return Err("无效的展示图片索引".into());
    }
    let existing = database.get_artwork_collection(request.track_id)?;
    let original: Vec<_> = existing
        .images
        .iter()
        .filter(|image| image.source == "embedded")
        .map(|image| image.picture.clone())
        .collect();
    let mut pictures = Vec::new();
    let mut draft = Draft {
        pictures: Vec::new(),
        display_index: request.display_index,
    };
    let mut embedded = HashSet::new();
    let mut paths = HashSet::new();
    let mut ids = HashSet::new();
    for item in request.pictures {
        let entry = match item {
            PictureDraft::Existing {
                artwork_id,
                picture_type,
            } => {
                if !ids.insert(artwork_id) {
                    return Err("图片集合包含重复项".into());
                }
                let image = existing
                    .images
                    .iter()
                    .find(|image| image.artwork_id == artwork_id)
                    .ok_or_else(|| "图片草稿引用了不属于曲目的图片".to_owned())?;
                if image.source == "embedded" {
                    let picture = Picture {
                        content: image.picture.content.clone(),
                        picture_type,
                    };
                    if !embedded.insert((picture.content.image.clone(), picture_type)) {
                        return Err("内嵌图片包含重复内容及类型".into());
                    }
                    pictures.push(picture);
                } else if !paths.insert(image.path.clone()) {
                    return Err("图片集合包含重复关联路径".into());
                }
                DraftPicture::Existing {
                    artwork_id,
                    picture_type,
                }
            }
            PictureDraft::Embedded { data, picture_type } => {
                let content = super::linked::decode(data)?;
                if !embedded.insert((content.image.clone(), picture_type)) {
                    return Err("内嵌图片包含重复内容及类型".into());
                }
                let picture = Picture {
                    content,
                    picture_type,
                };
                pictures.push(picture.clone());
                DraftPicture::New(picture)
            }
            PictureDraft::Linked { path, picture_type } => {
                let path = super::linked::normalize(&path)?;
                if !paths.insert(path.clone()) {
                    return Err("图片集合包含重复关联路径".into());
                }
                let content = super::linked::read(&path)?;
                DraftPicture::Linked {
                    path,
                    picture: Picture {
                        content,
                        picture_type,
                    },
                }
            }
        };
        draft.pictures.push(entry);
    }
    Ok(Prepared {
        embedded_changed: !same_embedded(&original, &pictures),
        draft,
        pictures,
    })
}

impl Prepared {
    pub(crate) fn requires_file_write(&self, path: &std::path::Path) -> Result<bool, String> {
        if !self.embedded_changed {
            return Ok(false);
        }
        let original = crate::metadata::files::artwork::read_embedded_pictures(path)?;
        Ok(!same_embedded(&original, &self.pictures))
    }
}

pub(crate) fn same_embedded(left: &[Picture], right: &[Picture]) -> bool {
    let signature = |pictures: &[Picture]| -> HashSet<_> {
        pictures
            .iter()
            .map(|picture| (picture.picture_type, picture.content.image.clone()))
            .collect()
    };
    signature(left) == signature(right)
}
