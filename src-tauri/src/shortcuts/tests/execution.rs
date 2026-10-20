use super::*;

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
