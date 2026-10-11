mod registration;

use crate::settings::SettingsState;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{mpsc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use registration::{Binding, Registration, ShortcutRuntime};

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ShortcutSettings {
    pub previous: ShortcutBinding,
    pub next: ShortcutBinding,
    pub toggle_playback: ShortcutBinding,
    pub toggle_window: ShortcutBinding,
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
    ToggleWindow,
}

impl ShortcutAction {
    fn playback_command(self) -> Option<&'static str> {
        match self {
            Self::Previous => Some("previous"),
            Self::Next => Some("next"),
            Self::TogglePlayback => Some("toggle"),
            Self::ToggleWindow => None,
        }
    }
}

impl ShortcutSettings {
    fn binding_mut(&mut self, action: ShortcutAction) -> &mut ShortcutBinding {
        match action {
            ShortcutAction::Previous => &mut self.previous,
            ShortcutAction::Next => &mut self.next,
            ShortcutAction::TogglePlayback => &mut self.toggle_playback,
            ShortcutAction::ToggleWindow => &mut self.toggle_window,
        }
    }

    fn parse_for_restore(&mut self) -> (Vec<Binding>, Vec<String>) {
        let mut bindings = Vec::new();
        let mut errors = Vec::new();
        let mut seen = HashSet::new();
        for action in [
            ShortcutAction::Previous,
            ShortcutAction::Next,
            ShortcutAction::TogglePlayback,
            ShortcutAction::ToggleWindow,
        ] {
            let definition = self.binding_mut(action);
            if definition.shortcut.is_empty() {
                continue;
            }
            match definition.shortcut.parse::<Shortcut>() {
                Ok(shortcut) if seen.insert(shortcut.id()) => bindings.push(Binding {
                    shortcut,
                    action,
                    text: definition.shortcut.clone(),
                    global: definition.global,
                }),
                result => {
                    errors.push(match result {
                        Err(error) => {
                            format!("Invalid shortcut '{}': {error}", definition.shortcut)
                        }
                        Ok(_) => format!("Duplicate shortcut '{}'", definition.shortcut),
                    });
                    *definition = ShortcutBinding::default();
                }
            }
        }
        (bindings, errors)
    }

    fn parse(&self) -> Result<Vec<Binding>, String> {
        let mut bindings = Vec::new();
        let mut seen = HashSet::new();
        for (definition, action) in [
            (&self.previous, ShortcutAction::Previous),
            (&self.next, ShortcutAction::Next),
            (&self.toggle_playback, ShortcutAction::TogglePlayback),
            (&self.toggle_window, ShortcutAction::ToggleWindow),
        ] {
            let text = &definition.shortcut;
            if text.is_empty() {
                continue;
            }
            let shortcut = text
                .parse::<Shortcut>()
                .map_err(|error| format!("Invalid shortcut '{text}': {error}"))?;
            if !seen.insert(shortcut.id()) {
                return Err(format!("Duplicate shortcut '{text}'"));
            }
            bindings.push(Binding {
                shortcut,
                action,
                text: text.clone(),
                global: definition.global,
            });
        }
        Ok(bindings)
    }
}

#[derive(Default)]
pub struct ShortcutsState {
    runtime: Mutex<ShortcutRuntime>,
    startup_error: Mutex<Option<String>>,
    events: Option<mpsc::Sender<(u32, ShortcutState)>>,
}

struct AppRegistration<'a, R: Runtime>(&'a AppHandle<R>);

impl<R: Runtime> Registration for AppRegistration<'_, R> {
    fn register(&mut self, binding: &Binding) -> Result<(), String> {
        self.0
            .global_shortcut()
            .register(binding.shortcut)
            .map_err(|error| format!("Could not register shortcut '{}': {error}", binding.text))
    }

    fn unregister(&mut self, binding: &Binding) -> Result<(), String> {
        self.0
            .global_shortcut()
            .unregister(binding.shortcut)
            .map_err(|error| format!("Could not unregister shortcut '{}': {error}", binding.text))
    }
}

fn restore_configuration(
    settings: &mut ShortcutSettings,
    runtime: &mut ShortcutRuntime,
    registry: &mut impl Registration,
) -> Vec<String> {
    let (bindings, mut errors) = settings.parse_for_restore();
    for (action, error) in runtime.restore(bindings, registry) {
        *settings.binding_mut(action) = ShortcutBinding::default();
        errors.push(error);
    }
    errors
}

pub fn initialize(app: &AppHandle, restoring: bool) {
    let (sender, receiver) = mpsc::channel();
    app.manage(ShortcutsState {
        events: Some(sender),
        ..ShortcutsState::default()
    });
    let result = (|| {
        let mut settings = app.state::<SettingsState>().get()?;
        let state = app.state::<ShortcutsState>();
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|error| format!("Could not initialize shortcuts: {error}"))?;
        if !restoring {
            return runtime.initialize(settings.shortcuts.parse()?, &mut AppRegistration(app));
        }
        let errors = restore_configuration(
            &mut settings.shortcuts,
            &mut runtime,
            &mut AppRegistration(app),
        );
        app.state::<SettingsState>().save(settings)?;
        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!("已清空不可用的快捷键：{}", errors.join("; ")))
        }
    })();
    if let Err(error) = result {
        log::warn!("Could not initialize global shortcuts: {error}");
        let state = app.state::<ShortcutsState>();
        match state.startup_error.lock() {
            Ok(mut current) => *current = Some(error.clone()),
            Err(lock_error) => log::warn!("Could not store shortcut startup error: {lock_error}"),
        }
        if let Err(emit_error) = app.emit("shortcuts-error", &error) {
            log::warn!("Could not notify shortcut error: {emit_error}");
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        while let Ok((id, event)) = receiver.recv() {
            let state = app.state::<ShortcutsState>();
            let action = match state.runtime.lock() {
                Ok(mut runtime) => runtime.event(id, event),
                Err(error) => {
                    log::warn!("Could not handle shortcut: {error}");
                    None
                }
            };
            if let Some(action) = action {
                if let Err(error) = execute(&app, action) {
                    log::warn!("Could not execute shortcut: {error}");
                    if let Err(emit_error) = app.emit("shortcuts-error", &error) {
                        log::warn!("Could not notify shortcut error: {emit_error}");
                    }
                }
            }
        }
    });
}

pub(crate) fn save_configuration<R: Runtime>(
    app: &AppHandle<R>,
    settings: &ShortcutSettings,
    persist: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let bindings = settings.parse()?;
    let state = app.state::<ShortcutsState>();
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|error| format!("Could not update shortcuts: {error}"))?;
    runtime.save(bindings, &mut AppRegistration(app), persist)?;
    clear_error(&state);
    Ok(())
}

fn clear_error(state: &ShortcutsState) {
    match state.startup_error.lock() {
        Ok(mut error) => *error = None,
        Err(error) => log::warn!("Could not clear shortcut error: {error}"),
    }
}

fn execute(app: &AppHandle, action: ShortcutAction) -> Result<(), String> {
    if let Some(command) = action.playback_command() {
        crate::playback::session::system_command(app, command);
        Ok(())
    } else {
        crate::window::toggle_main_window(app)
    }
}

#[tauri::command]
pub async fn run_shortcut(app: AppHandle, action: ShortcutAction) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || execute(&app, action))
        .await
        .map_err(|error| format!("Could not execute shortcut: {error}"))?
}

pub fn handle_global_event(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    // The plugin invokes handlers with its registration mutex held. Never acquire
    // the runtime mutex here: registration waits for the main thread.
    let Some(state) = app.try_state::<ShortcutsState>() else {
        return;
    };
    if let Some(sender) = &state.events {
        if let Err(error) = sender.send((shortcut.id(), event.state)) {
            log::warn!("Could not dispatch shortcut: {error}");
        }
    }
}

#[tauri::command]
pub async fn set_shortcuts_suspended(app: AppHandle, suspended: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ShortcutsState>();
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|error| format!("Could not suspend shortcuts: {error}"))?;
        runtime.set_suspended(suspended, &mut AppRegistration(&app))?;
        if !suspended {
            clear_error(&state);
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Could not suspend shortcuts: {error}"))?
}

#[tauri::command]
pub fn get_shortcuts_error(state: State<'_, ShortcutsState>) -> Result<Option<String>, String> {
    state
        .startup_error
        .lock()
        .map(|error| error.clone())
        .map_err(|error| format!("Could not read shortcut error: {error}"))
}

#[cfg(test)]
mod tests;
