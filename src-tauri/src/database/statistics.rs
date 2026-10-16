use super::Database;
use crate::playback::statistics::TrackPlayStatistics;

impl Database {
    pub(crate) fn record_track_play(&self, track_id: i64) -> Result<bool, String> {
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO track_play_statistics (track_id, play_count)
                 SELECT id, 1 FROM tracks WHERE id = ?1 AND in_library = 1
                 ON CONFLICT(track_id) DO UPDATE SET play_count = play_count + 1",
                [track_id],
            )
            .map(|changed| changed > 0)
            .map_err(|error| format!("Could not save track play count: {error}"))
    }

    pub(crate) fn list_playback_statistics(&self) -> Result<Vec<TrackPlayStatistics>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT t.id, t.title, t.artist, t.album, s.play_count, t.album_artist
                 FROM track_play_statistics s JOIN tracks t ON t.id = s.track_id
                 WHERE t.in_library = 1
                 ORDER BY s.play_count DESC, COALESCE(t.title, '') COLLATE NOCASE, t.id",
            )
            .map_err(|error| format!("Could not query playback statistics: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(TrackPlayStatistics {
                    track_id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    album: row.get(3)?,
                    play_count: row.get(4)?,
                    album_artist: row.get(5)?,
                })
            })
            .map_err(|error| format!("Could not read playback statistics: {error}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("Could not read playback statistics: {error}"))
    }
}

#[cfg(test)]
#[path = "tests/statistics.rs"]
mod tests;
