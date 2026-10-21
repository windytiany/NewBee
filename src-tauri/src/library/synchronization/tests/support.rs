use super::super::configuration::{Folder, Mode};
use crate::{database::Database, fixtures::TestFiles, settings::SettingsState};
use std::{ops::Deref, path::Path};

pub(crate) fn settings(root: &Path) -> SettingsState {
    let settings = SettingsState::load(root.join("settings.json")).unwrap();
    settings
        .update_folders(|folders| {
            *folders = vec![Folder {
                path: std::fs::canonicalize(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                mode: Mode::Manual,
                enabled: true,
            }];
            Ok(())
        })
        .unwrap();
    settings
}

pub(super) struct Scan {
    pub(super) database: Database,
    settings: SettingsState,
    _files: TestFiles,
}

impl Deref for Scan {
    type Target = Database;
    fn deref(&self) -> &Database {
        &self.database
    }
}

impl Scan {
    pub(super) fn open(path: impl AsRef<Path>) -> Result<Self, Box<dyn std::error::Error>> {
        let files = TestFiles::new();
        let settings_path = if path.as_ref() == Path::new(":memory:") {
            files.0.join("settings.json")
        } else {
            path.as_ref().with_extension("json")
        };
        Ok(Self {
            database: Database::open(path)?,
            settings: SettingsState::load(settings_path)?,
            _files: files,
        })
    }

    pub(super) fn add_folder(&self, path: &str) -> Result<bool, String> {
        let mut added = false;
        self.settings.update_folders(|folders| {
            if !folders.iter().any(|folder| folder.path == path) {
                folders.push(Folder {
                    path: path.into(),
                    mode: Mode::Manual,
                    enabled: true,
                });
                added = true;
            }
            Ok(())
        })?;
        Ok(added)
    }
}

pub(super) fn run_scan(
    scan: &Scan,
    progress: impl FnMut(usize, usize),
) -> Result<crate::library::model::ImportResult, String> {
    run_scan_with_replay_gain(scan, false, progress)
}

pub(super) fn run_scan_with_replay_gain(
    scan: &Scan,
    fill_replay_gain: bool,
    progress: impl FnMut(usize, usize),
) -> Result<crate::library::model::ImportResult, String> {
    use super::super::{reconciliation, SynchronizationState};
    reconciliation::run(
        &scan.database,
        &SynchronizationState::default(),
        &scan.settings.get()?.synchronization_folders,
        fill_replay_gain,
        progress,
    )
}
