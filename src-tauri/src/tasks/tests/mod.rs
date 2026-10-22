use super::*;
mod commands;

fn entry(id: &str, paths: &[&str]) -> Entry {
    Entry {
        id: id.into(),
        fingerprint: id.into(),
        paths: paths.iter().map(|path| (*path).into()).collect(),
        track_ids: vec![],
        cancelled: Arc::new(AtomicBool::new(false)),
        running: false,
        expected: vec![],
    }
}

#[test]
fn reservations_are_fifo_and_conflicting_batches_are_rejected_atomically() {
    let mut queue = Queue::default();
    assert_eq!(queue.reserve(entry("first", &["one"])).unwrap(), None);
    assert_eq!(queue.reserve(entry("second", &["two"])).unwrap(), None);
    assert_eq!(
        queue.reserve(entry("first", &["one"])).unwrap(),
        Some("first".into())
    );
    assert!(queue.reserve(entry("conflict", &["three", "one"])).is_err());
    assert_eq!(queue.pending.len(), 2);
    assert_eq!(queue.pending.pop_front().unwrap().id, "first");
    assert_eq!(queue.pending.pop_front().unwrap().id, "second");
    assert!(queue.reserve(entry("retry", &["one", "three"])).is_ok());
}

#[test]
fn restore_rejects_new_submissions() {
    let mut queue = Queue {
        restoring: true,
        ..Default::default()
    };
    assert!(queue.reserve(entry("task", &[])).is_err());
    assert!(queue.pending.is_empty());
}

#[test]
fn cancellation_is_thread_local_and_nested_context_is_restored() {
    let flag = Arc::new(AtomicBool::new(true));
    CANCELLATION.with(|current| *current.borrow_mut() = Some(flag));
    assert!(cancelled());
    scope(None, || assert!(!cancelled()));
    assert!(cancelled());
    assert!(!std::thread::spawn(cancelled).join().unwrap());
    CANCELLATION.with(|current| *current.borrow_mut() = None);
    assert!(!cancelled());
}
