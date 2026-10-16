use super::*;
use std::collections::HashSet;

#[derive(Default)]
struct FakeRegistration {
    active: HashSet<u32>,
    blocked: HashSet<u32>,
    fail_unregister: Option<u32>,
    calls: Vec<(bool, u32)>,
}

impl Registration for FakeRegistration {
    fn register(&mut self, binding: &Binding) -> Result<(), String> {
        let id = binding.shortcut.id();
        self.calls.push((true, id));
        if self.blocked.contains(&id) || !self.active.insert(id) {
            return Err(format!("Shortcut '{}' is occupied", binding.text));
        }
        Ok(())
    }

    fn unregister(&mut self, binding: &Binding) -> Result<(), String> {
        let id = binding.shortcut.id();
        self.calls.push((false, id));
        if self.fail_unregister == Some(id) {
            self.fail_unregister = None;
            return Err(format!("Cannot unregister '{}'", binding.text));
        }
        assert!(self.active.remove(&id));
        Ok(())
    }
}

fn definition(shortcut: &str, global: bool) -> ShortcutBinding {
    ShortcutBinding {
        shortcut: shortcut.to_owned(),
        global,
    }
}

fn settings(previous: &str, next: &str) -> ShortcutSettings {
    ShortcutSettings {
        previous: definition(previous, true),
        next: definition(next, true),
        ..ShortcutSettings::default()
    }
}

fn ids(bindings: &[Binding]) -> HashSet<u32> {
    bindings
        .iter()
        .map(|binding| binding.shortcut.id())
        .collect()
}

#[test]
fn defaults_are_unique_local_and_match_frontend_actions() {
    let config = ShortcutSettings::defaults();
    let bindings = config.parse().unwrap();
    assert_eq!(bindings.len(), ShortcutAction::ALL.len() - 1);
    assert!(bindings.iter().all(|binding| !binding.global));
    assert_eq!(config.seek_forward.shortcut, "Ctrl+ArrowRight");
    assert_eq!(config.show_commands.shortcut, "Ctrl+KeyK");
    let source = include_str!("../../../src/features/shortcuts/bindings.ts");
    for binding in bindings {
        let action = serde_json::to_value(binding.action).unwrap();
        let action = action.as_str().unwrap();
        let definition = source
            .split(&format!("  {action}: {{"))
            .nth(1)
            .unwrap()
            .split("},")
            .next()
            .unwrap();
        assert!(definition.contains(&format!("shortcut: \"{}\"", binding.text)));
        assert!(definition.contains(&format!("global: {}", binding.action.allows_global())));
    }
}

#[test]
fn only_audio_and_window_actions_allow_global_registration() {
    for action in ShortcutAction::ALL {
        let mut config = ShortcutSettings::default();
        *config.binding_mut(action) = definition("Ctrl+KeyG", true);
        let name = serde_json::to_value(action).unwrap();
        let allowed =
            !name.as_str().unwrap().starts_with("show") && action != ShortcutAction::AddToQueue;
        assert_eq!(config.parse().is_ok(), allowed, "{name}");
    }
}

#[test]
fn repeated_global_events_repeat_only_seeking_and_volume() {
    for action in [
        ShortcutAction::VolumeUp,
        ShortcutAction::SeekForward,
        ShortcutAction::ToggleMute,
    ] {
        let mut config = ShortcutSettings::default();
        *config.binding_mut(action) = definition("Ctrl+KeyG", true);
        let mut runtime = ShortcutRuntime::default();
        let mut registry = FakeRegistration::default();
        runtime
            .initialize(config.parse().unwrap(), &mut registry)
            .unwrap();
        let id = "Ctrl+KeyG".parse::<Shortcut>().unwrap().id();
        assert_eq!(runtime.event(id, ShortcutState::Pressed), Some(action));
        assert_eq!(
            runtime.event(id, ShortcutState::Pressed),
            action.repeats().then_some(action)
        );
        assert_eq!(runtime.event(id, ShortcutState::Released), None);
        assert_eq!(runtime.event(id, ShortcutState::Pressed), Some(action));
    }
}

#[test]
fn page_shortcuts_are_local_only_and_share_conflict_validation() {
    for action in [
        ShortcutAction::ShowPlaying,
        ShortcutAction::ShowLibrary,
        ShortcutAction::ShowPlaylist,
        ShortcutAction::ShowInbox,
    ] {
        let mut config = ShortcutSettings::default();
        *config.binding_mut(action) = definition("Ctrl+Digit1", false);
        assert_eq!(config.parse().unwrap()[0].action, action);
        let mut runtime = ShortcutRuntime::default();
        let mut registry = FakeRegistration::default();
        runtime
            .initialize(config.parse().unwrap(), &mut registry)
            .unwrap();
        assert!(registry.active.is_empty());
        config.previous = definition("Ctrl+Digit1", false);
        assert!(config.parse().is_err());
        config.previous = ShortcutBinding::default();
        config.binding_mut(action).global = true;
        assert!(config.parse().is_err());
        let (_, errors) = config.parse_for_restore();
        assert_eq!(errors.len(), 1);
        assert_eq!(*config.binding_mut(action), ShortcutBinding::default());
    }
}

#[test]
fn restore_clears_only_invalid_duplicate_or_occupied_bindings() {
    let mut config = ShortcutSettings {
        previous: definition("Ctrl+Unknown", false),
        next: definition("Ctrl+KeyN", true),
        toggle_playback: definition("Space", false),
        toggle_window: definition("Space", true),
        ..ShortcutSettings::default()
    };
    let blocked = "Ctrl+KeyN".parse::<Shortcut>().unwrap().id();
    let mut registry = FakeRegistration {
        blocked: HashSet::from([blocked]),
        ..FakeRegistration::default()
    };
    let mut runtime = ShortcutRuntime::default();
    let errors = restore_configuration(&mut config, &mut runtime, &mut registry);
    assert_eq!(errors.len(), 3);
    assert_eq!(config.previous, ShortcutBinding::default());
    assert_eq!(config.next, ShortcutBinding::default());
    assert_eq!(config.toggle_window, ShortcutBinding::default());
    assert_eq!(config.toggle_playback, definition("Space", false));
    assert!(registry.active.is_empty());
    assert!(config.parse().is_ok());
    runtime.set_suspended(true, &mut registry).unwrap();
    runtime.set_suspended(false, &mut registry).unwrap();
    assert!(registry.active.is_empty());
}

#[test]
fn restore_preserves_usable_global_and_local_bindings() {
    let mut config = settings("Ctrl+KeyP", "Ctrl+KeyN");
    config.toggle_playback = definition("Space", false);
    let mut registry = FakeRegistration::default();
    let mut runtime = ShortcutRuntime::default();
    assert!(restore_configuration(&mut config, &mut runtime, &mut registry).is_empty());
    let previous = "Ctrl+KeyP".parse::<Shortcut>().unwrap().id();
    assert_eq!(registry.active.len(), 2);
    assert_eq!(
        runtime.event(previous, ShortcutState::Pressed),
        Some(ShortcutAction::Previous)
    );
    runtime.set_suspended(true, &mut registry).unwrap();
    assert!(registry.active.is_empty());
    runtime.set_suspended(false, &mut registry).unwrap();
    assert_eq!(registry.active.len(), 2);
}

#[test]
fn settings_contract_defaults_and_preserves_accelerators() {
    let defaults = ShortcutSettings::default();
    for binding in [
        &defaults.previous,
        &defaults.next,
        &defaults.toggle_playback,
        &defaults.toggle_window,
        &defaults.show_playing,
        &defaults.show_library,
        &defaults.show_playlist,
        &defaults.show_inbox,
    ] {
        assert!(!binding.global);
        assert!(binding.shortcut.is_empty());
    }
    assert!(defaults.parse().unwrap().is_empty());
    let settings = ShortcutSettings {
        previous: definition("Ctrl+Alt+Shift+Super+KeyA", true),
        next: definition("Ctrl+Digit1", true),
        toggle_playback: definition("Space", true),
        toggle_window: definition("Super+ArrowLeft", true),
        ..ShortcutSettings::default()
    };
    let value = serde_json::to_value(&settings).unwrap();
    assert_eq!(
        value["togglePlayback"],
        serde_json::json!({"shortcut": "Space", "global": true})
    );
    assert_eq!(
        value["toggleWindow"],
        serde_json::json!({"shortcut": "Super+ArrowLeft", "global": true})
    );
    assert_eq!(
        serde_json::from_value::<ShortcutSettings>(value).unwrap(),
        settings
    );
    assert_eq!(
        settings.parse().unwrap()[0].text,
        settings.previous.shortcut
    );
    for code in [
        "KeyA",
        "Digit1",
        "Space",
        "ArrowLeft",
        "F1",
        "F24",
        "NumpadEnter",
        "BracketLeft",
    ] {
        assert!(settings_for_code(code).parse().is_ok(), "{code}");
    }
}

fn settings_for_code(code: &str) -> ShortcutSettings {
    settings(&format!("Ctrl+Alt+Shift+Super+{code}"), "")
}

#[test]
fn invalid_and_duplicate_accelerators_rejected_even_in_local_mode() {
    for text in [
        " ",
        "Ctrl",
        "Ctrl+",
        "Ctrl+KeyA+Shift",
        "Ctrl+Unknown",
        "KeyA+KeyB",
    ] {
        let mut config = settings(text, "");
        config.previous.global = false;
        config.next.global = false;
        let error = config.parse().unwrap_err();
        assert!(error.contains(text));
    }
    for (previous, next) in [
        ("Ctrl+KeyA", "Control+A"),
        ("Alt+Shift+KeyA", "Shift+Alt+KeyA"),
    ] {
        let mut config = settings(previous, next);
        config.previous.global = false;
        config.next.global = false;
        assert!(config.parse().unwrap_err().contains(next));
    }
}

#[test]
fn local_mode_persists_desired_without_global_registration() {
    let mut runtime = ShortcutRuntime::default();
    let mut registry = FakeRegistration::default();
    let mut config = settings("Ctrl+KeyA", "Ctrl+KeyB");
    config.previous.global = false;
    config.next.global = false;
    let mut bindings = config.parse().unwrap();
    let mut persisted = false;
    runtime
        .save(bindings.clone(), &mut registry, || {
            persisted = true;
            Ok(())
        })
        .unwrap();
    assert!(persisted);
    assert!(registry.active.is_empty());
    assert!(registry.calls.is_empty());
    runtime.set_suspended(true, &mut registry).unwrap();
    runtime.set_suspended(false, &mut registry).unwrap();
    assert!(registry.calls.is_empty());
    for binding in &mut bindings {
        binding.global = true;
    }
    runtime
        .save(bindings.clone(), &mut registry, || Ok(()))
        .unwrap();
    assert_eq!(registry.active, ids(&bindings));
    for binding in &mut bindings {
        binding.global = false;
    }
    runtime.save(bindings, &mut registry, || Ok(())).unwrap();
    assert!(registry.active.is_empty());
}

#[test]
fn partial_registration_conflict_rolls_back_without_persisting() {
    let mut runtime = ShortcutRuntime::default();
    let mut registry = FakeRegistration::default();
    let old = settings("Ctrl+KeyA", "").parse().unwrap();
    runtime.save(old.clone(), &mut registry, || Ok(())).unwrap();
    let new = settings("Ctrl+KeyB", "Ctrl+KeyC").parse().unwrap();
    registry.blocked.insert(new[1].shortcut.id());
    let error = runtime
        .save(new, &mut registry, || panic!("must not persist"))
        .unwrap_err();
    assert!(error.contains("Ctrl+KeyC"));
    assert_eq!(registry.active, ids(&old));
    runtime.set_suspended(true, &mut registry).unwrap();
    runtime.set_suspended(false, &mut registry).unwrap();
    assert_eq!(registry.active, ids(&old));
}

#[test]
fn persistence_failure_restores_old_bindings_and_desired_configuration() {
    let mut runtime = ShortcutRuntime::default();
    let mut registry = FakeRegistration::default();
    let old = settings("Ctrl+KeyA", "Ctrl+KeyB").parse().unwrap();
    runtime.save(old.clone(), &mut registry, || Ok(())).unwrap();
    let new = settings("Ctrl+KeyC", "Ctrl+KeyD").parse().unwrap();
    assert_eq!(
        runtime.save(new, &mut registry, || Err("disk full".to_owned())),
        Err("disk full".to_owned())
    );
    assert_eq!(registry.active, ids(&old));
    runtime.set_suspended(true, &mut registry).unwrap();
    runtime.set_suspended(false, &mut registry).unwrap();
    assert_eq!(registry.active, ids(&old));
}

#[test]
fn suspended_save_attempts_registration_and_failure_preserves_suspension() {
    let mut runtime = ShortcutRuntime::default();
    let mut registry = FakeRegistration::default();
    let old = settings("Ctrl+KeyA", "").parse().unwrap();
    runtime.save(old.clone(), &mut registry, || Ok(())).unwrap();
    runtime.set_suspended(true, &mut registry).unwrap();
    assert!(registry.active.is_empty());
    let new = settings("Ctrl+KeyB", "Ctrl+KeyC").parse().unwrap();
    registry.blocked.insert(new[1].shortcut.id());
    assert!(runtime
        .save(new.clone(), &mut registry, || panic!("must not persist"))
        .is_err());
    assert!(registry.active.is_empty());
    assert_eq!(
        runtime.event(old[0].shortcut.id(), ShortcutState::Pressed),
        None
    );
    registry.blocked.clear();
    assert!(runtime
        .save(new.clone(), &mut registry, || Err("disk".to_owned()))
        .is_err());
    assert!(registry.active.is_empty());
    runtime.set_suspended(false, &mut registry).unwrap();
    assert_eq!(registry.active, ids(&old));
    runtime.set_suspended(true, &mut registry).unwrap();
    runtime.save(new.clone(), &mut registry, || Ok(())).unwrap();
    assert_eq!(registry.active, ids(&new));
    assert_eq!(
        runtime.event(new[0].shortcut.id(), ShortcutState::Pressed),
        Some(ShortcutAction::Previous)
    );
}

#[test]
fn suspension_and_resume_failure_restore_previous_mode() {
    let mut runtime = ShortcutRuntime::default();
    let mut registry = FakeRegistration::default();
    let bindings = settings("Ctrl+KeyA", "Ctrl+KeyB").parse().unwrap();
    runtime
        .save(bindings.clone(), &mut registry, || Ok(()))
        .unwrap();
    registry.fail_unregister = Some(bindings[1].shortcut.id());
    assert!(runtime.set_suspended(true, &mut registry).is_err());
    assert_eq!(registry.active, ids(&bindings));
    assert_eq!(
        runtime.event(bindings[0].shortcut.id(), ShortcutState::Pressed),
        Some(ShortcutAction::Previous)
    );
    runtime.set_suspended(true, &mut registry).unwrap();
    registry.blocked.insert(bindings[1].shortcut.id());
    assert!(runtime.set_suspended(false, &mut registry).is_err());
    assert!(registry.active.is_empty());
    assert_eq!(
        runtime.event(bindings[0].shortcut.id(), ShortcutState::Pressed),
        None
    );
    registry.blocked.clear();
    runtime.set_suspended(false, &mut registry).unwrap();
    assert_eq!(registry.active, ids(&bindings));
}

#[test]
fn startup_conflict_keeps_desired_for_resume_and_rolls_back_partial_registration() {
    let mut runtime = ShortcutRuntime::default();
    let mut registry = FakeRegistration::default();
    let bindings = settings("Ctrl+KeyA", "Ctrl+KeyB").parse().unwrap();
    registry.blocked.insert(bindings[1].shortcut.id());
    assert!(runtime.initialize(bindings.clone(), &mut registry).is_err());
    assert!(registry.active.is_empty());
    registry.blocked.clear();
    runtime.set_suspended(false, &mut registry).unwrap();
    assert_eq!(registry.active, ids(&bindings));
}

#[test]
fn unchanged_accelerators_do_not_reregister_and_update_action() {
    let mut runtime = ShortcutRuntime::default();
    let mut registry = FakeRegistration::default();
    let old = settings("Ctrl+KeyA", "").parse().unwrap();
    runtime.save(old.clone(), &mut registry, || Ok(())).unwrap();
    registry.calls.clear();
    let new = settings("", "Ctrl+KeyA").parse().unwrap();
    runtime.save(new, &mut registry, || Ok(())).unwrap();
    assert!(registry.calls.is_empty());
    assert_eq!(
        runtime.event(old[0].shortcut.id(), ShortcutState::Pressed),
        Some(ShortcutAction::Next)
    );
}

#[test]
fn global_events_execute_once_per_press_and_never_on_release() {
    let mut runtime = ShortcutRuntime::default();
    let mut registry = FakeRegistration::default();
    let config = ShortcutSettings {
        previous: definition("Ctrl+KeyA", true),
        next: definition("Ctrl+KeyB", true),
        toggle_playback: definition("Ctrl+KeyC", true),
        toggle_window: definition("Ctrl+KeyD", true),
        ..ShortcutSettings::default()
    };
    let bindings = config.parse().unwrap();
    runtime
        .save(bindings.clone(), &mut registry, || Ok(()))
        .unwrap();
    for binding in &bindings {
        let id = binding.shortcut.id();
        assert_eq!(runtime.event(id, ShortcutState::Released), None);
        assert_eq!(
            runtime.event(id, ShortcutState::Pressed),
            Some(binding.action)
        );
        assert_eq!(runtime.event(id, ShortcutState::Pressed), None);
        assert_eq!(runtime.event(id, ShortcutState::Released), None);
        assert_eq!(
            runtime.event(id, ShortcutState::Pressed),
            Some(binding.action)
        );
    }
    assert_eq!(runtime.event(u32::MAX, ShortcutState::Pressed), None);
}

#[test]
fn actions_match_frontend_contract_and_playback_session_commands() {
    for (action, name, command) in [
        (ShortcutAction::Previous, "previous", Some("previous")),
        (ShortcutAction::Next, "next", Some("next")),
        (
            ShortcutAction::TogglePlayback,
            "togglePlayback",
            Some("toggle"),
        ),
        (ShortcutAction::ToggleWindow, "toggleWindow", None),
    ] {
        assert_eq!(serde_json::to_value(action).unwrap(), name);
        assert_eq!(
            serde_json::from_value::<ShortcutAction>(serde_json::json!(name)).unwrap(),
            action
        );
        assert_eq!(action.playback_command(), command);
    }
    assert!(serde_json::from_str::<ShortcutAction>("\"toggle\"").is_err());
}

#[test]
fn mixed_scopes_register_and_resume_only_global_bindings() {
    let mut runtime = ShortcutRuntime::default();
    let mut registry = FakeRegistration::default();
    let config = ShortcutSettings {
        previous: definition("Ctrl+KeyA", true),
        next: definition("Ctrl+KeyB", false),
        toggle_playback: definition("Ctrl+KeyC", true),
        toggle_window: definition("Ctrl+KeyD", false),
        ..ShortcutSettings::default()
    };
    let bindings = config.parse().unwrap();
    let global: Vec<_> = bindings
        .iter()
        .filter(|binding| binding.global)
        .cloned()
        .collect();
    let local: Vec<_> = bindings
        .iter()
        .filter(|binding| !binding.global)
        .cloned()
        .collect();
    for binding in &local {
        registry.blocked.insert(binding.shortcut.id());
    }
    runtime.initialize(bindings, &mut registry).unwrap();
    assert_eq!(registry.active, ids(&global));
    for binding in &local {
        assert_eq!(
            runtime.event(binding.shortcut.id(), ShortcutState::Pressed),
            None
        );
    }
    runtime.set_suspended(true, &mut registry).unwrap();
    assert!(registry.active.is_empty());
    for binding in &global {
        assert_eq!(
            runtime.event(binding.shortcut.id(), ShortcutState::Pressed),
            None
        );
    }
    runtime.set_suspended(false, &mut registry).unwrap();
    assert_eq!(registry.active, ids(&global));
    assert!(registry
        .calls
        .iter()
        .all(|(_, id)| ids(&global).contains(id)));
    for binding in &global {
        assert_eq!(
            runtime.event(binding.shortcut.id(), ShortcutState::Pressed),
            Some(binding.action)
        );
    }
}

#[test]
fn changing_one_scope_only_updates_that_registration() {
    let mut runtime = ShortcutRuntime::default();
    let mut registry = FakeRegistration::default();
    let mut config = settings("Ctrl+KeyA", "Ctrl+KeyB");
    config.next.global = false;
    let bindings = config.parse().unwrap();
    let previous_id = bindings[0].shortcut.id();
    let next_id = bindings[1].shortcut.id();
    runtime.save(bindings, &mut registry, || Ok(())).unwrap();
    registry.calls.clear();
    config.next.global = true;
    runtime
        .save(config.parse().unwrap(), &mut registry, || Ok(()))
        .unwrap();
    assert_eq!(registry.calls, vec![(true, next_id)]);
    assert_eq!(registry.active, HashSet::from([previous_id, next_id]));
    registry.calls.clear();
    config.previous.global = false;
    runtime
        .save(config.parse().unwrap(), &mut registry, || Ok(()))
        .unwrap();
    assert_eq!(registry.calls, vec![(false, previous_id)]);
    assert_eq!(registry.active, HashSet::from([next_id]));
    assert_eq!(runtime.event(previous_id, ShortcutState::Pressed), None);
    assert_eq!(
        runtime.event(next_id, ShortcutState::Pressed),
        Some(ShortcutAction::Next)
    );
    runtime.set_suspended(true, &mut registry).unwrap();
    runtime.set_suspended(false, &mut registry).unwrap();
    assert_eq!(registry.active, HashSet::from([next_id]));
}

#[test]
fn duplicate_accelerators_rejected_across_scopes_and_all_actions() {
    for global in [false, true] {
        let mut config = settings("Ctrl+KeyA", "");
        config.previous.global = global;
        config.toggle_window = definition("Control+A", !global);
        assert!(config.parse().unwrap_err().contains("Control+A"));
        config.toggle_window = ShortcutBinding::default();
        config.toggle_playback = definition("Control+A", !global);
        assert!(config.parse().unwrap_err().contains("Control+A"));
    }
}

#[test]
fn failed_scope_change_restores_previous_desired_scopes() {
    let mut runtime = ShortcutRuntime::default();
    let mut registry = FakeRegistration::default();
    let mut config = settings("Ctrl+KeyA", "Ctrl+KeyB");
    config.next.global = false;
    let old = config.parse().unwrap();
    let previous_id = old[0].shortcut.id();
    let next_id = old[1].shortcut.id();
    runtime.save(old, &mut registry, || Ok(())).unwrap();
    config.previous.global = false;
    config.next.global = true;
    assert_eq!(
        runtime.save(config.parse().unwrap(), &mut registry, || Err(
            "disk full".to_owned()
        )),
        Err("disk full".to_owned())
    );
    assert_eq!(registry.active, HashSet::from([previous_id]));
    runtime.set_suspended(true, &mut registry).unwrap();
    runtime.set_suspended(false, &mut registry).unwrap();
    assert_eq!(registry.active, HashSet::from([previous_id]));
    assert_eq!(runtime.event(next_id, ShortcutState::Pressed), None);
}
