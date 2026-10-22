use super::*;

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
