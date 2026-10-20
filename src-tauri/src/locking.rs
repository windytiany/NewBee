use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Default)]
pub(crate) struct WriteState(Arc<AtomicBool>);

impl WriteState {
    pub(crate) fn acquire(&self) -> Result<WriteGuard, String> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "数据写入或备份任务正在运行，请稍后重试".to_owned())?;
        Ok(WriteGuard(Arc::clone(&self.0)))
    }
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
    fn scan_and_import_share_an_exclusive_guard_that_releases_on_drop() {
        let state = WriteState::default();
        let guard = state.acquire().unwrap();
        assert!(state.acquire().is_err());
        drop(guard);
        assert!(state.acquire().is_ok());
    }
}
