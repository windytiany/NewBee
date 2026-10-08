CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
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
    image BLOB NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS artwork_thumbnails (
    image_id INTEGER NOT NULL REFERENCES artwork_images(id) ON DELETE CASCADE,
    size INTEGER NOT NULL CHECK (size BETWEEN 1 AND 4096),
    image BLOB NOT NULL,
    PRIMARY KEY (image_id, size)
);

CREATE TABLE IF NOT EXISTS track_artwork (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    image_id INTEGER NOT NULL REFERENCES artwork_images(id),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('embedded', 'directory')),
    source_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS music_library_directories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE
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
