use super::*;

#[test]
fn defaults_are_unique_local_and_match_frontend_actions() {
    let config = ShortcutSettings::defaults();
    let bindings = config.parse().unwrap();
    assert_eq!(bindings.len(), ShortcutAction::ALL.len() - 1);
    assert!(bindings.iter().all(|binding| !binding.global));
    assert_eq!(config.seek_forward.shortcut, "Ctrl+ArrowRight");
    assert_eq!(config.show_commands.shortcut, "Ctrl+KeyK");
    let source = include_str!("../../../../src/features/shortcuts/bindings.ts");
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
