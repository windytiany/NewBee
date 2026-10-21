use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Default)]
pub(crate) struct WriteState {
    data: Arc<AtomicBool>,
    settings: Arc<AtomicBool>,
}

impl WriteState {
    pub(crate) fn acquire(&self) -> Result<WriteGuard, String> {
        Self::acquire_lock(&self.data)
    }

    pub(crate) fn acquire_settings(&self) -> Result<WriteGuard, String> {
        Self::acquire_lock(&self.settings)
    }

    pub(crate) fn acquire_all(&self) -> Result<ExclusiveWriteGuard, String> {
        let data = self.acquire()?;
        let settings = self.acquire_settings()?;
        Ok(ExclusiveWriteGuard {
            _data: data,
            _settings: settings,
        })
    }

    fn acquire_lock(lock: &Arc<AtomicBool>) -> Result<WriteGuard, String> {
        lock.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "数据写入或备份任务正在运行，请稍后重试".to_owned())?;
        Ok(WriteGuard(Arc::clone(lock)))
    }
}

pub(crate) struct ExclusiveWriteGuard {
    _data: WriteGuard,
    _settings: WriteGuard,
}

pub(crate) struct WriteGuard(Arc<AtomicBool>);

impl Drop for WriteGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::WriteState;

    #[test]
    fn settings_and_data_writes_can_run_together_but_exclusive_tasks_cannot() {
        let state = WriteState::default();
        let data = state.acquire().unwrap();
        let settings = state.acquire_settings().unwrap();
        assert!(state.acquire_settings().is_err());
        assert!(state.acquire_all().is_err());
        drop(data);
        assert!(state.acquire_all().is_err());
        assert!(state.acquire().is_ok());
        drop(settings);
        let exclusive = state.acquire_all().unwrap();
        assert!(state.acquire().is_err());
        assert!(state.acquire_settings().is_err());
        drop(exclusive);
        assert!(state.acquire_all().is_ok());
    }

    #[test]
    fn scan_and_import_share_an_exclusive_guard_that_releases_on_drop() {
        let state = WriteState::default();
        let guard = state.acquire().unwrap();
        assert!(state.acquire().is_err());
        drop(guard);
        assert!(state.acquire().is_ok());
    }
}
