use super::{Draft, DraftPicture, Picture};
use crate::{artwork::model::ArtworkContent, database::Database};
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
    Existing {
        content_id: String,
        picture_type: u8,
    },
    #[serde(rename_all = "camelCase")]
    New { data: Vec<u8>, picture_type: u8 },
}

pub(crate) struct Prepared {
    pub(crate) draft: Draft,
    pub(crate) pictures: Vec<Picture>,
    pub(crate) embed: bool,
}

pub(crate) fn prepare(
    database: &Database,
    track_ids: &[i64],
    requests: Vec<TrackDraft>,
    embed: bool,
) -> Result<Vec<(i64, Prepared)>, String> {
    let mut seen = HashSet::new();
    let mut prepared = Vec::new();
    for request in requests {
        if !track_ids.contains(&request.track_id) || !seen.insert(request.track_id) {
            return Err("图片草稿包含重复或非目标曲目".into());
        }
        if request
            .display_index
            .is_some_and(|index| index >= request.pictures.len())
        {
            return Err("无效的展示图片索引".into());
        }
        let existing = database.get_artwork_collection(request.track_id)?;
        let mut pictures = Vec::new();
        let mut draft = Draft {
            pictures: Vec::new(),
            display_index: request.display_index,
        };
        let mut contents = HashSet::new();
        for item in request.pictures {
            let (picture, entry) = match item {
                PictureDraft::Existing {
                    content_id,
                    picture_type,
                } => {
                    let image = existing
                        .images
                        .iter()
                        .find(|image| image.content_id == content_id)
                        .ok_or_else(|| "图片草稿引用了不属于曲目的内容".to_owned())?;
                    (
                        Picture {
                            content: image.picture.content.clone(),
                            picture_type,
                        },
                        DraftPicture::Existing {
                            content_id,
                            picture_type,
                        },
                    )
                }
                PictureDraft::New { data, picture_type } => {
                    let decoded = crate::metadata::files::cover_picture(&data)?;
                    let picture = Picture {
                        content: ArtworkContent {
                            mime_type: decoded
                                .mime_type()
                                .map(ToString::to_string)
                                .unwrap_or_default(),
                            image: data,
                        },
                        picture_type,
                    };
                    (picture.clone(), DraftPicture::New(picture))
                }
            };
            let content_id = picture.content.image.clone();
            if !contents.insert(content_id) {
                return Err("图片集合包含重复内容".into());
            }
            pictures.push(picture);
            draft.pictures.push(entry);
        }
        prepared.push((
            request.track_id,
            Prepared {
                draft,
                pictures,
                embed,
            },
        ));
    }
    Ok(prepared)
}
