CREATE TABLE IF NOT EXISTS inbox (
    track_id INTEGER PRIMARY KEY NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    in_library INTEGER NOT NULL DEFAULT 0 CHECK (in_library IN (0, 1)),
    metadata_revision INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    artist TEXT,
    album TEXT,
    album_artist TEXT,
    release_date TEXT,
    disc_number INTEGER,
    track_number INTEGER,
    disc_total INTEGER,
    track_total INTEGER,
    duration_ms INTEGER,
    codec TEXT,
    sample_rate_hz INTEGER,
    bitrate_kbps INTEGER,
    channels INTEGER
);

CREATE TABLE IF NOT EXISTS track_scan (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    metadata_revision INTEGER NOT NULL,
    fingerprint TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS track_artwork_pending (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS track_lyrics (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    text TEXT,
    no_lyrics INTEGER NOT NULL DEFAULT 0 CHECK (no_lyrics IN (0, 1)),
    CHECK (text IS NULL OR no_lyrics = 0)
);

CREATE TABLE IF NOT EXISTS skipped_tracks (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS artwork_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mime_type TEXT NOT NULL,
    digest BLOB NOT NULL CHECK (length(digest) = 32),
    content_id TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
    image BLOB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artwork_images_digest ON artwork_images(digest);

CREATE TABLE IF NOT EXISTS track_artwork (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    image_id INTEGER NOT NULL REFERENCES artwork_images(id),
    picture_type INTEGER NOT NULL CHECK (picture_type BETWEEN 0 AND 255),
    is_display INTEGER NOT NULL DEFAULT 0 CHECK (is_display IN (0, 1)),
    source_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_track_artwork_display
    ON track_artwork(track_id) WHERE is_display = 1;

CREATE TABLE IF NOT EXISTS track_artwork_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artwork_id INTEGER NOT NULL REFERENCES track_artwork(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('embedded', 'directory', 'manual')),
    source_path TEXT NOT NULL,
    picture_type INTEGER NOT NULL CHECK (picture_type BETWEEN 0 AND 255),
    UNIQUE (artwork_id)
);

CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_album_artist_album
    ON tracks(album_artist, album);
CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist_position
    ON playlist_items(playlist_id, position, id);
CREATE INDEX IF NOT EXISTS idx_playlist_items_track
    ON playlist_items(track_id);

CREATE TABLE IF NOT EXISTS track_play_statistics (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    play_count INTEGER NOT NULL CHECK (play_count > 0)
);

CREATE TRIGGER IF NOT EXISTS clear_statistics_after_library_removal
AFTER UPDATE OF in_library ON tracks
WHEN OLD.in_library = 1 AND NEW.in_library = 0
BEGIN
    DELETE FROM track_play_statistics WHERE track_id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS track_editing (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    snapshot TEXT NOT NULL,
    scan_issue TEXT
);

CREATE TRIGGER IF NOT EXISTS remove_unreferenced_artwork_after_delete
AFTER DELETE ON track_artwork
BEGIN
    DELETE FROM artwork_images WHERE id = OLD.image_id
        AND NOT EXISTS (SELECT 1 FROM track_artwork WHERE image_id = OLD.image_id);
END;

CREATE TRIGGER IF NOT EXISTS remove_unreferenced_artwork_after_replace
AFTER UPDATE OF image_id ON track_artwork
WHEN OLD.image_id != NEW.image_id
BEGIN
    DELETE FROM artwork_images WHERE id = OLD.image_id
        AND NOT EXISTS (SELECT 1 FROM track_artwork WHERE image_id = OLD.image_id);
END;
