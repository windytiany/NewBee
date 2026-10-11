CREATE TABLE IF NOT EXISTS track_play_statistics (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    play_count INTEGER NOT NULL CHECK (play_count > 0)
);
