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
    duration_ms INTEGER,
    codec TEXT,
    sample_rate_hz INTEGER,
    bitrate_kbps INTEGER,
    channels INTEGER
);

CREATE TABLE IF NOT EXISTS skipped_tracks (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS track_artwork (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    mime_type TEXT NOT NULL,
    image BLOB NOT NULL
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
