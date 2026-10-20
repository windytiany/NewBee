use super::*;

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
