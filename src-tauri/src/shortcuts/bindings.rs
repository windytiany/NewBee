use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri_plugin_global_shortcut::Shortcut;

use super::registration::Binding;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ShortcutSettings {
    pub previous: ShortcutBinding,
    pub next: ShortcutBinding,
    pub toggle_playback: ShortcutBinding,
    pub seek_backward: ShortcutBinding,
    pub seek_forward: ShortcutBinding,
    pub volume_down: ShortcutBinding,
    pub volume_up: ShortcutBinding,
    pub toggle_mute: ShortcutBinding,
    pub toggle_shuffle: ShortcutBinding,
    pub toggle_repeat: ShortcutBinding,
    pub toggle_window: ShortcutBinding,
    pub show_playing: ShortcutBinding,
    pub show_library: ShortcutBinding,
    pub show_playlist: ShortcutBinding,
    pub show_inbox: ShortcutBinding,
    pub show_settings: ShortcutBinding,
    pub show_commands: ShortcutBinding,
    pub show_shortcuts: ShortcutBinding,
    pub add_to_queue: ShortcutBinding,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ShortcutBinding {
    pub shortcut: String,
    pub global: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutAction {
    Previous,
    Next,
    TogglePlayback,
    SeekBackward,
    SeekForward,
    VolumeDown,
    VolumeUp,
    ToggleMute,
    ToggleShuffle,
    ToggleRepeat,
    ToggleWindow,
    ShowPlaying,
    ShowLibrary,
    ShowPlaylist,
    ShowInbox,
    ShowSettings,
    ShowCommands,
    ShowShortcuts,
    AddToQueue,
}

impl ShortcutAction {
    pub(super) const ALL: [Self; 19] = [
        Self::Previous,
        Self::Next,
        Self::TogglePlayback,
        Self::SeekBackward,
        Self::SeekForward,
        Self::VolumeDown,
        Self::VolumeUp,
        Self::ToggleMute,
        Self::ToggleShuffle,
        Self::ToggleRepeat,
        Self::ToggleWindow,
        Self::ShowPlaying,
        Self::ShowLibrary,
        Self::ShowPlaylist,
        Self::ShowInbox,
        Self::ShowSettings,
        Self::ShowCommands,
        Self::ShowShortcuts,
        Self::AddToQueue,
    ];

    pub(super) fn allows_global(self) -> bool {
        self == Self::ToggleWindow || self.playback_command().is_some()
    }

    pub(super) fn repeats(self) -> bool {
        matches!(
            self,
            Self::SeekBackward | Self::SeekForward | Self::VolumeDown | Self::VolumeUp
        )
    }

    pub(super) fn playback_command(self) -> Option<&'static str> {
        match self {
            Self::Previous => Some("previous"),
            Self::Next => Some("next"),
            Self::TogglePlayback => Some("toggle"),
            Self::SeekBackward => Some("seekBackward"),
            Self::SeekForward => Some("seekForward"),
            Self::VolumeDown => Some("volumeDown"),
            Self::VolumeUp => Some("volumeUp"),
            Self::ToggleMute => Some("mute"),
            Self::ToggleShuffle => Some("shuffle"),
            Self::ToggleRepeat => Some("repeat"),
            _ => None,
        }
    }

    fn default_shortcut(self) -> &'static str {
        match self {
            Self::Previous => "Ctrl+Shift+ArrowLeft",
            Self::Next => "Ctrl+Shift+ArrowRight",
            Self::TogglePlayback => "Space",
            Self::SeekBackward => "Ctrl+ArrowLeft",
            Self::SeekForward => "Ctrl+ArrowRight",
            Self::VolumeDown => "Ctrl+ArrowDown",
            Self::VolumeUp => "Ctrl+ArrowUp",
            Self::ToggleMute => "Ctrl+Shift+KeyM",
            Self::ToggleShuffle => "Ctrl+Shift+KeyS",
            Self::ToggleRepeat => "Ctrl+Shift+KeyR",
            Self::ToggleWindow => "",
            Self::ShowPlaying => "Ctrl+Digit1",
            Self::ShowLibrary => "Ctrl+Digit2",
            Self::ShowPlaylist => "Ctrl+Digit3",
            Self::ShowInbox => "Ctrl+Digit4",
            Self::ShowSettings => "Ctrl+Comma",
            Self::ShowCommands => "Ctrl+KeyK",
            Self::ShowShortcuts => "Ctrl+Slash",
            Self::AddToQueue => "Ctrl+Enter",
        }
    }
}

impl ShortcutSettings {
    pub(crate) fn defaults() -> Self {
        let mut settings = Self::default();
        for action in ShortcutAction::ALL {
            settings.binding_mut(action).shortcut = action.default_shortcut().to_owned();
        }
        settings
    }

    pub(super) fn binding_mut(&mut self, action: ShortcutAction) -> &mut ShortcutBinding {
        match action {
            ShortcutAction::Previous => &mut self.previous,
            ShortcutAction::Next => &mut self.next,
            ShortcutAction::TogglePlayback => &mut self.toggle_playback,
            ShortcutAction::SeekBackward => &mut self.seek_backward,
            ShortcutAction::SeekForward => &mut self.seek_forward,
            ShortcutAction::VolumeDown => &mut self.volume_down,
            ShortcutAction::VolumeUp => &mut self.volume_up,
            ShortcutAction::ToggleMute => &mut self.toggle_mute,
            ShortcutAction::ToggleShuffle => &mut self.toggle_shuffle,
            ShortcutAction::ToggleRepeat => &mut self.toggle_repeat,
            ShortcutAction::ToggleWindow => &mut self.toggle_window,
            ShortcutAction::ShowPlaying => &mut self.show_playing,
            ShortcutAction::ShowLibrary => &mut self.show_library,
            ShortcutAction::ShowPlaylist => &mut self.show_playlist,
            ShortcutAction::ShowInbox => &mut self.show_inbox,
            ShortcutAction::ShowSettings => &mut self.show_settings,
            ShortcutAction::ShowCommands => &mut self.show_commands,
            ShortcutAction::ShowShortcuts => &mut self.show_shortcuts,
            ShortcutAction::AddToQueue => &mut self.add_to_queue,
        }
    }

    pub(super) fn parse_for_restore(&mut self) -> (Vec<Binding>, Vec<String>) {
        let mut bindings = Vec::new();
        let mut errors = Vec::new();
        let mut seen = HashSet::new();
        for action in ShortcutAction::ALL {
            let definition = self.binding_mut(action);
            match parse_binding(definition, action, &mut seen) {
                Ok(Some(binding)) => bindings.push(binding),
                Ok(None) => {}
                Err(error) => {
                    errors.push(error);
                    *definition = ShortcutBinding::default();
                }
            }
        }
        (bindings, errors)
    }

    pub(super) fn parse(&self) -> Result<Vec<Binding>, String> {
        let mut settings = self.clone();
        let mut bindings = Vec::new();
        let mut seen = HashSet::new();
        for action in ShortcutAction::ALL {
            if let Some(binding) = parse_binding(settings.binding_mut(action), action, &mut seen)? {
                bindings.push(binding);
            }
        }
        Ok(bindings)
    }
}

fn parse_binding(
    definition: &ShortcutBinding,
    action: ShortcutAction,
    seen: &mut HashSet<u32>,
) -> Result<Option<Binding>, String> {
    if definition.global && !action.allows_global() {
        return Err("Application shortcuts cannot be global".to_owned());
    }
    let text = &definition.shortcut;
    if text.is_empty() {
        return Ok(None);
    }
    let shortcut = text
        .parse::<Shortcut>()
        .map_err(|error| format!("Invalid shortcut '{text}': {error}"))?;
    if !seen.insert(shortcut.id()) {
        return Err(format!("Duplicate shortcut '{text}'"));
    }
    Ok(Some(Binding {
        shortcut,
        action,
        text: text.clone(),
        global: definition.global,
    }))
}
