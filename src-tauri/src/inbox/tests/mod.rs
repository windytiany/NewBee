use super::*;
use crate::{
    fixtures::TestFiles,
    metadata::{
        files,
        model::{MetadataChange, MetadataField},
    },
};
use support::*;

mod commands;
mod ingest;
mod reading;
mod register;
mod support;
