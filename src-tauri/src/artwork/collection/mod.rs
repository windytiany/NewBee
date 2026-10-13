pub(crate) mod commands;
pub(crate) mod editing;

use super::model::ArtworkContent;

#[derive(Debug, Clone)]
pub struct Picture {
    pub content: ArtworkContent,
    pub picture_type: u8,
}

#[derive(Debug)]
pub struct DirectoryPicture {
    pub path: String,
    pub content: Result<ArtworkContent, String>,
}

#[derive(Debug)]
pub struct Scan {
    pub embedded: Result<Vec<Picture>, String>,
    pub directory: Result<Vec<DirectoryPicture>, String>,
}

impl Scan {
    pub fn issues(&self) -> Vec<&str> {
        let mut issues = Vec::new();
        if let Err(error) = &self.embedded {
            issues.push(error.as_str());
        }
        match &self.directory {
            Err(error) => issues.push(error.as_str()),
            Ok(pictures) => {
                for picture in pictures {
                    if let Err(error) = &picture.content {
                        issues.push(error.as_str());
                    }
                }
            }
        }
        issues
    }
}

#[derive(Debug)]
pub struct Image {
    pub content_id: String,
    pub picture: Picture,
}

#[derive(Debug, Default)]
pub struct Collection {
    pub images: Vec<Image>,
    pub display_index: Option<usize>,
}

#[derive(Debug, Clone)]
pub enum DraftPicture {
    Existing {
        content_id: String,
        picture_type: u8,
    },
    New(Picture),
}

#[derive(Debug, Default, Clone)]
pub struct Draft {
    pub pictures: Vec<DraftPicture>,
    pub display_index: Option<usize>,
}

impl From<Collection> for Draft {
    fn from(collection: Collection) -> Self {
        Self {
            pictures: collection
                .images
                .into_iter()
                .map(|image| DraftPicture::Existing {
                    content_id: image.content_id,
                    picture_type: image.picture.picture_type,
                })
                .collect(),
            display_index: collection.display_index,
        }
    }
}
