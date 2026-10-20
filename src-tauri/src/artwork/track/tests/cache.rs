use super::*;

fn content(index: u8) -> String {
    format!("{:064x}-{:032x}", index, index)
}

#[test]
fn atomic_entries_round_trip_and_detect_truncation_and_corruption() {
    let cache = Cache::temporary().unwrap();
    let key = content(1);
    assert!(cache.read(&key, 128).unwrap().is_none());
    cache.write(&key, 128, b"encoded webp").unwrap();
    assert_eq!(cache.read(&key, 128).unwrap().unwrap(), b"encoded webp");
    let path = cache.path(&key, 128).unwrap();
    let mut bytes = fs::read(&path).unwrap();
    bytes[HEADER] ^= 1;
    fs::write(&path, bytes).unwrap();
    assert!(cache.read(&key, 128).unwrap().is_none());
    assert!(!path.exists());
    fs::write(&path, b"truncated").unwrap();
    assert!(cache.read(&key, 128).unwrap().is_none());
    cache.write(&key, 128, b"rebuilt").unwrap();
    assert_eq!(cache.read(&key, 128).unwrap().unwrap(), b"rebuilt");
    assert_eq!(fs::read_dir(&cache.root).unwrap().count(), 1);
    assert!(cache.write(&key, 129, b"arbitrary").is_err());
    assert!(cache.read("../outside", 128).is_err());
}

#[test]
fn cleanup_removes_orphans_old_versions_invalid_sizes_and_abandoned_writes() {
    let cache = Cache::temporary().unwrap();
    let live = content(1);
    let orphan = content(2);
    cache.write(&live, 128, b"live").unwrap();
    cache.write(&orphan, 512, b"orphan").unwrap();
    fs::write(
        cache.root.join(format!("{live}-128-webp0.cache")),
        b"obsolete",
    )
    .unwrap();
    fs::write(
        cache.root.join(format!("{live}-333-{ENCODING}.cache")),
        b"invalid",
    )
    .unwrap();
    fs::write(cache.root.join("pending-crashed.tmp"), b"partial").unwrap();
    fs::write(cache.root.join("unrelated.txt"), b"unrelated").unwrap();
    cache.clean(&HashSet::from([live.clone()])).unwrap();
    assert_eq!(fs::read_dir(&cache.root).unwrap().count(), 2);
    assert_eq!(cache.read(&live, 128).unwrap().unwrap(), b"live");
    assert!(cache.read(&orphan, 512).unwrap().is_none());
    assert_eq!(
        fs::read(cache.root.join("unrelated.txt")).unwrap(),
        b"unrelated"
    );
}

#[test]
fn eviction_uses_last_access_and_never_exceeds_total_capacity() {
    let mut cache = Cache::temporary().unwrap();
    cache.capacity = 2 * (HEADER as u64 + 10);
    for index in [1, 2] {
        cache.write(&content(index), 128, &[index; 10]).unwrap();
        let path = cache.path(&content(index), 128).unwrap();
        OpenOptions::new()
            .write(true)
            .open(path)
            .unwrap()
            .set_times(FileTimes::new().set_modified(
                SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(index.into()),
            ))
            .unwrap();
    }
    cache.read(&content(1), 128).unwrap();
    cache.write(&content(3), 128, &[3; 10]).unwrap();
    assert!(cache.read(&content(2), 128).unwrap().is_none());
    assert!(cache.read(&content(1), 128).unwrap().is_some());
    assert!(cache.read(&content(3), 128).unwrap().is_some());
    cache.write(&content(4), 128, &[4; 200]).unwrap();
    assert!(cache.read(&content(4), 128).unwrap().is_none());
    let total: u64 = fs::read_dir(&cache.root)
        .unwrap()
        .map(|entry| entry.unwrap().metadata().unwrap().len())
        .sum();
    assert!(total <= cache.capacity);
}

#[test]
fn simultaneous_readers_never_observe_partial_publication() {
    let cache = Cache::temporary().unwrap();
    let key = content(1);
    std::thread::scope(|scope| {
        scope.spawn(|| {
            for index in 0..20 {
                cache.write(&key, 128, &[index; 4096]).unwrap();
            }
        });
        for _ in 0..4 {
            scope.spawn(|| {
                for _ in 0..20 {
                    if let Some(bytes) = cache.read(&key, 128).unwrap() {
                        assert_eq!(bytes.len(), 4096);
                        assert!(bytes.iter().all(|byte| *byte == bytes[0]));
                    }
                }
            });
        }
    });
}
