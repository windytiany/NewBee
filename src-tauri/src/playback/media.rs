use crate::artwork::model::TrackArtwork;
use crate::database::Database;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use windows::core::{factory, HSTRING};
use windows::Foundation::TypedEventHandler;
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls,
    SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
};
use windows::Storage::Streams::{
    DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference,
};
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

pub struct SystemMedia {
    controls: Mutex<SystemMediaTransportControls>,
    button_token: i64,
    diagnostics: Mutex<crate::logging::RepeatedFailure>,
}

pub fn initialize(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window is unavailable")?;
    let interop: ISystemMediaTransportControlsInterop =
        factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()?;
    // The main window owns the HWND for the lifetime of these controls.
    let hwnd = windows::Win32::Foundation::HWND(window.hwnd()?.0);
    let controls: SystemMediaTransportControls = unsafe { interop.GetForWindow(hwnd) }?;
    controls.SetIsPlayEnabled(true)?;
    controls.SetIsPauseEnabled(true)?;
    controls.SetIsPreviousEnabled(true)?;
    controls.SetIsNextEnabled(true)?;
    controls.SetIsEnabled(false)?;
    let event_app = app.clone();
    let button_token = controls.ButtonPressed(&TypedEventHandler::<
        SystemMediaTransportControls,
        SystemMediaTransportControlsButtonPressedEventArgs,
    >::new(move |_, args| {
        let Some(args) = args.as_ref() else {
            return Ok(());
        };
        let command = match args.Button()? {
            SystemMediaTransportControlsButton::Play => "play",
            SystemMediaTransportControlsButton::Pause => "pause",
            SystemMediaTransportControlsButton::Previous => "previous",
            SystemMediaTransportControlsButton::Next => "next",
            _ => return Ok(()),
        };
        super::session::system_command(&event_app, command);
        Ok(())
    }))?;
    app.manage(SystemMedia {
        controls: Mutex::new(controls),
        button_token,
        diagnostics: Mutex::new(crate::logging::RepeatedFailure::default()),
    });
    Ok(())
}

// Integration failures must not turn a successful audio command into a failed playback attempt.
fn update(
    app: &AppHandle,
    action: impl FnOnce(&SystemMediaTransportControls) -> Result<(), String>,
) {
    let Some(media) = app.try_state::<SystemMedia>() else {
        return;
    };
    let result = media
        .controls
        .lock()
        .map_err(|_| "Windows media state is unavailable".to_owned())
        .and_then(|controls| action(&controls));
    if let Ok(mut diagnostics) = media.diagnostics.lock() {
        diagnostics.report(
            "playback.system_media",
            result.as_ref().err().map(String::as_str),
        );
    };
}

pub fn set_track(
    app: &AppHandle,
    database: &Database,
    track_id: Option<i64>,
    title: &str,
    artist: &str,
) {
    update(app, |controls| {
        let updater = controls
            .DisplayUpdater()
            .map_err(|error| error.to_string())?;
        updater.ClearAll().map_err(|error| error.to_string())?;
        updater
            .SetType(MediaPlaybackType::Music)
            .map_err(|error| error.to_string())?;
        let properties = updater
            .MusicProperties()
            .map_err(|error| error.to_string())?;
        properties
            .SetTitle(&HSTRING::from(title))
            .map_err(|error| error.to_string())?;
        properties
            .SetArtist(&HSTRING::from(artist))
            .map_err(|error| error.to_string())?;
        // ClearAll also clears the previous thumbnail when this track has no artwork.
        // Artwork failure should not prevent the title/artist from being published.
        if let Some(track_id) = track_id {
            if let Err(error) = set_artwork(database, track_id, &updater) {
                log::warn!("Could not update Windows media artwork: {error}");
            }
        }
        updater.Update().map_err(|error| error.to_string())?;
        controls
            .SetIsEnabled(true)
            .map_err(|error| error.to_string())?;
        controls
            .SetPlaybackStatus(MediaPlaybackStatus::Playing)
            .map_err(|error| error.to_string())
    });
}

fn set_artwork(
    database: &Database,
    track_id: i64,
    updater: &windows::Media::SystemMediaTransportControlsDisplayUpdater,
) -> Result<(), String> {
    let Some(TrackArtwork::Available { data, .. }) = database.get_track_artwork(track_id)? else {
        return Ok(());
    };
    let write_thumbnail = || -> windows::core::Result<()> {
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(&data)?;
        writer.StoreAsync()?.get()?;
        writer.DetachStream()?;
        stream.Seek(0)?;
        updater.SetThumbnail(&RandomAccessStreamReference::CreateFromStream(&stream)?)
    };
    write_thumbnail().map_err(|error| error.to_string())
}

pub fn set_playback(app: &AppHandle, has_audio: bool, is_playing: bool) {
    update(app, |controls| {
        let status = if !has_audio {
            MediaPlaybackStatus::Stopped
        } else if is_playing {
            MediaPlaybackStatus::Playing
        } else {
            MediaPlaybackStatus::Paused
        };
        if controls
            .PlaybackStatus()
            .map_err(|error| error.to_string())?
            != status
        {
            controls
                .SetPlaybackStatus(status)
                .map_err(|error| error.to_string())?;
        }
        if !has_audio {
            controls
                .DisplayUpdater()
                .and_then(|updater| {
                    updater.ClearAll()?;
                    updater.Update()
                })
                .map_err(|error| error.to_string())?;
            controls
                .SetIsEnabled(false)
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    });
}

impl Drop for SystemMedia {
    fn drop(&mut self) {
        if let Ok(controls) = self.controls.get_mut() {
            if let Err(error) = controls.RemoveButtonPressed(self.button_token) {
                log::warn!("Could not detach Windows media controls: {error}");
            }
            if let Err(error) = controls.SetIsEnabled(false) {
                log::warn!("Could not disable Windows media controls: {error}");
            }
        }
    }
}
