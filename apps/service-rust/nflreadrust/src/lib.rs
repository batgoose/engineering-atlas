pub mod models;

use anyhow::Result;
use chrono::NaiveDate;
use futures_util::StreamExt;
use models::PlayRecord;
use sqlx::{Pool, Postgres};
use std::path::PathBuf;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

pub const BASE_URL: &str = "https://github.com/nflverse/nflverse-data/releases/download/pbp";

/// Streams the CSV file from GitHub to a local temp file.
pub async fn download_season(year: i32) -> Result<PathBuf> {
    let url = format!("{}/play_by_play_{}.csv", BASE_URL, year);
    let mut save_path = std::env::temp_dir();
    save_path.push(format!("nfl_pbp_{}.csv", year));

    if save_path.exists() {
        return Ok(save_path);
    }

    // Use reqwest to fetch
    let response = reqwest::get(&url).await?;
    if !response.status().is_success() {
        anyhow::bail!("Failed to get file: Status {}", response.status());
    }

    let mut file = File::create(&save_path).await?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        file.write_all(&chunk?).await?;
    }
    file.flush().await?;

    Ok(save_path)
}

/// Reads CSV and inserts in batches
pub async fn process_and_insert_season(path: &PathBuf, pool: &Pool<Postgres>) -> Result<usize> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_path(path)?;

    let mut batch: Vec<PlayRecord> = Vec::with_capacity(1000);
    let mut total_count = 0;

    for record in rdr.deserialize().flatten() { 
        batch.push(record);
        if batch.len() >= 1000 {
            insert_batch(pool, &batch).await?;
            total_count += batch.len();
            batch.clear();
        }
    }

    if !batch.is_empty() {
        insert_batch(pool, &batch).await?;
        total_count += batch.len();
    }

    Ok(total_count)
}

/// The actual SQL writing logic
pub async fn insert_batch(pool: &Pool<Postgres>, plays: &[PlayRecord]) -> Result<()> {
    let mut query_builder = sqlx::QueryBuilder::new(
        "INSERT INTO plays (
            game_id, play_id, old_game_id, drive,
            home_team, away_team, posteam, posteam_type, defteam,
            game_date, season_type, week, stadium, weather, surface, roof,
            qtr, quarter_seconds_remaining, half_seconds_remaining, game_seconds_remaining,
            down, ydstogo, yardline_100, side_of_field, shotgun, no_huddle,
            play_type, yards_gained, air_yards, yards_after_catch, epa, wpa, success,
            passer_player_id, passer_player_name,
            rusher_player_id, rusher_player_name,
            receiver_player_id, receiver_player_name,
            touchdown, interception, fumble, sack, complete_pass, pass_touchdown, rush_touchdown,
            field_goal_result, kick_distance, punt_blocked,
            penalty, penalty_type, penalty_yards
        ) ",
    );

    query_builder.push_values(plays, |mut b, play| {
        let parsed_date = play
            .game_date
            .as_ref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());

        b.push_bind(&play.game_id)
            .push_bind(play.play_id)
            .push_bind(&play.old_game_id)
            .push_bind(play.drive)
            .push_bind(&play.home_team)
            .push_bind(&play.away_team)
            .push_bind(&play.posteam)
            .push_bind(&play.posteam_type)
            .push_bind(&play.defteam)
            .push_bind(parsed_date)
            .push_bind(&play.season_type)
            .push_bind(play.week)
            .push_bind(&play.stadium)
            .push_bind(&play.weather)
            .push_bind(&play.surface)
            .push_bind(&play.roof)
            .push_bind(play.qtr)
            .push_bind(play.quarter_seconds_remaining)
            .push_bind(play.half_seconds_remaining)
            .push_bind(play.game_seconds_remaining)
            .push_bind(play.down)
            .push_bind(play.ydstogo)
            .push_bind(play.yardline_100)
            .push_bind(&play.side_of_field)
            .push_bind(play.shotgun)
            .push_bind(play.no_huddle)
            .push_bind(&play.play_type)
            .push_bind(play.yards_gained)
            .push_bind(play.air_yards)
            .push_bind(play.yards_after_catch)
            .push_bind(play.epa)
            .push_bind(play.wpa)
            .push_bind(play.success)
            .push_bind(&play.passer_player_id)
            .push_bind(&play.passer_player_name)
            .push_bind(&play.rusher_player_id)
            .push_bind(&play.rusher_player_name)
            .push_bind(&play.receiver_player_id)
            .push_bind(&play.receiver_player_name)
            .push_bind(play.touchdown)
            .push_bind(play.interception)
            .push_bind(play.fumble)
            .push_bind(play.sack)
            .push_bind(play.complete_pass)
            .push_bind(play.pass_touchdown)
            .push_bind(play.rush_touchdown)
            .push_bind(&play.field_goal_result)
            .push_bind(play.kick_distance)
            .push_bind(play.punt_blocked)
            .push_bind(play.penalty)
            .push_bind(&play.penalty_type)
            .push_bind(play.penalty_yards);
    });

    query_builder.push(" ON CONFLICT (game_id, play_id) DO NOTHING");

    let query = query_builder.build();
    query.execute(pool).await?;

    Ok(())
}

#[cfg(test)]
mod unit_tests {
    use super::*;
    use chrono::Datelike;
    use models::PlayRecord;

    #[test]
    fn test_parse_sparse_row_timeout() {
        // FIXED: We only include the mandatory columns + posteam.
        // This is much harder to break than the long string.
        let csv_data = "\
play_id,game_id,home_team,away_team,season_type,week,shotgun,no_huddle,posteam
50,2023_01_DET_KC,KC,DET,REG,1,0,0,";
        // Note the trailing comma above ^ explicitly making 'posteam' empty

        let mut rdr = csv::ReaderBuilder::new()
            .has_headers(true)
            .flexible(true)
            .from_reader(csv_data.as_bytes());

        let result = rdr.deserialize::<PlayRecord>().next();

        let record = result
            .expect("Iterator should have one item")
            .expect("Should parse timeout row without error");

        assert_eq!(record.play_id, 50.0);
        assert_eq!(record.week, 1);
        // The core test: 'posteam' should be None because we left it empty
        assert_eq!(record.posteam, None);
    }

    #[test]
    fn test_date_parsing_logic() {
        // We manually test the logic we used inside insert_batch
        // (String -> NaiveDate conversion)

        let date_str = Some("2023-12-25".to_string());

        let parsed = date_str
            .as_ref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());

        assert!(parsed.is_some());
        let d = parsed.unwrap();
        assert_eq!(d.year(), 2023);
        assert_eq!(d.month(), 12);
        assert_eq!(d.day(), 25);
    }

    #[test]
    fn test_bad_date_handling() {
        // What happens if the date is garbage?
        let date_str = Some("Not-A-Date".to_string());

        let parsed = date_str
            .as_ref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());

        // It should gracefully return None, not panic
        assert!(parsed.is_none());
    }
}
