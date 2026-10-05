use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Default)]
pub(crate) struct WriteState(Arc<AtomicBool>);

impl WriteState {
    pub(crate) fn acquire(&self) -> Result<WriteGuard, String> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| {
                "音乐库扫描、导入、标签保存或歌词下载任务正在运行，请稍后重试".to_owned()
            })?;
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
#[path = "tests/write.rs"]
mod tests;
