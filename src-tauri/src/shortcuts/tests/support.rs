use super::*;

#[derive(Default)]
pub(super) struct FakeRegistration {
    pub(super) active: HashSet<u32>,
    pub(super) blocked: HashSet<u32>,
    pub(super) fail_unregister: Option<u32>,
    pub(super) calls: Vec<(bool, u32)>,
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

pub(super) fn definition(shortcut: &str, global: bool) -> ShortcutBinding {
    ShortcutBinding {
        shortcut: shortcut.to_owned(),
        global,
    }
}

pub(super) fn settings(previous: &str, next: &str) -> ShortcutSettings {
    ShortcutSettings {
        previous: definition(previous, true),
        next: definition(next, true),
        ..ShortcutSettings::default()
    }
}

pub(super) fn ids(bindings: &[Binding]) -> HashSet<u32> {
    bindings
        .iter()
        .map(|binding| binding.shortcut.id())
        .collect()
}
pub(super) fn settings_for_code(code: &str) -> ShortcutSettings {
    settings(&format!("Ctrl+Alt+Shift+Super+{code}"), "")
}
