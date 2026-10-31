use super::ShortcutAction;
use std::collections::HashSet;
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

#[derive(Clone, Debug)]
pub(super) struct Binding {
    pub shortcut: Shortcut,
    pub action: ShortcutAction,
    pub text: String,
    pub global: bool,
}

pub(super) trait Registration {
    fn register(&mut self, binding: &Binding) -> Result<(), String>;
    fn unregister(&mut self, binding: &Binding) -> Result<(), String>;
}

#[derive(Default)]
pub(super) struct ShortcutRuntime {
    desired: Vec<Binding>,
    suspended: bool,
    active: Vec<Binding>,
    pressed: HashSet<u32>,
}

impl ShortcutRuntime {
    fn transition(
        &mut self,
        target: &[Binding],
        registry: &mut impl Registration,
    ) -> Result<(), String> {
        for binding in target {
            if !self
                .active
                .iter()
                .any(|active| active.shortcut == binding.shortcut)
            {
                registry.register(binding)?;
                self.active.push(binding.clone());
            }
        }
        let removed: Vec<_> = self
            .active
            .iter()
            .filter(|active| {
                !target
                    .iter()
                    .any(|binding| active.shortcut == binding.shortcut)
            })
            .cloned()
            .collect();
        for binding in removed {
            registry.unregister(&binding)?;
            self.active
                .retain(|active| active.shortcut != binding.shortcut);
        }
        self.active = target.to_vec();
        self.pressed.clear();
        Ok(())
    }

    fn rollback(
        &mut self,
        old: &[Binding],
        registry: &mut impl Registration,
        error: String,
    ) -> String {
        match self.transition(old, registry) {
            Ok(()) => error,
            Err(rollback) => format!("{error}; shortcut rollback failed: {rollback}"),
        }
    }

    pub fn restore(
        &mut self,
        desired: Vec<Binding>,
        registry: &mut impl Registration,
    ) -> Vec<(ShortcutAction, String)> {
        let mut failures = Vec::new();
        for binding in desired {
            if binding.global {
                if let Err(error) = registry.register(&binding) {
                    failures.push((binding.action, error));
                    continue;
                }
                self.active.push(binding.clone());
            }
            self.desired.push(binding);
        }
        failures
    }

    pub fn initialize(
        &mut self,
        desired: Vec<Binding>,
        registry: &mut impl Registration,
    ) -> Result<(), String> {
        self.desired = desired.clone();
        match self.save(desired, registry, || Ok(()))? {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    pub fn save(
        &mut self,
        desired: Vec<Binding>,
        registry: &mut impl Registration,
        persist: impl FnOnce() -> Result<(), String>,
    ) -> Result<Option<String>, String> {
        persist()?;
        let old = self.active.clone();
        let target: Vec<_> = desired
            .iter()
            .filter(|binding| binding.global)
            .cloned()
            .collect();
        self.desired = desired;
        if let Err(error) = self.transition(&target, registry) {
            return Ok(Some(self.rollback(&old, registry, error)));
        }
        self.suspended = false;
        Ok(None)
    }

    pub fn set_suspended(
        &mut self,
        suspended: bool,
        registry: &mut impl Registration,
    ) -> Result<(), String> {
        let old = self.active.clone();
        let target = if suspended {
            Vec::new()
        } else {
            self.desired
                .iter()
                .filter(|binding| binding.global)
                .cloned()
                .collect()
        };
        if let Err(error) = self.transition(&target, registry) {
            return Err(self.rollback(&old, registry, error));
        }
        self.suspended = suspended;
        Ok(())
    }

    pub fn event(&mut self, id: u32, state: ShortcutState) -> Option<ShortcutAction> {
        if state == ShortcutState::Released {
            self.pressed.remove(&id);
            return None;
        }
        if self.suspended {
            return None;
        }
        let binding = self
            .active
            .iter()
            .find(|binding| binding.shortcut.id() == id)?;
        let first = self.pressed.insert(id);
        (first || binding.action.repeats()).then_some(binding.action)
    }
}
