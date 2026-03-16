use anyhow::{Context, Result};
use futures_util::StreamExt;
use parquet::file::reader::{FileReader, SerializedFileReader};
use parquet::record::Row;
use sha2::{Digest, Sha256};
use sqlx::QueryBuilder;
use sqlx::{Pool, Postgres};
use std::fs::File as StdFile;
use std::path::PathBuf;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const BASE_URL: &str = "https://github.com/nflverse/nflverse-data/releases/download/pbp";

pub struct SeasonDownload {
    pub year: i32,
    pub url: String,
    pub path: PathBuf,
    pub checksum_sha256: String,
}

#[derive(Debug, Clone)]
pub struct RawPbpRow {
    pub batch_id: Option<i64>,
    pub game_id: String,
    pub play_id: String,
    pub season: Option<i32>,
    pub week: Option<i32>,
    pub posteam: Option<String>,
    pub defteam: Option<String>,
    pub source_row_number: i32,
    pub payload: serde_json::Value,
}

pub async fn download_season(year: i32) -> Result<SeasonDownload> {
    let url = format!("{}/play_by_play_{}.parquet", BASE_URL, year);
    let mut save_path = std::env::temp_dir();
    save_path.push(format!("nfl_pbp_{}.parquet", year));

    if save_path.exists() {
        let checksum = file_sha256_hex(&save_path).await?;
        return Ok(SeasonDownload {
            year,
            url,
            path: save_path,
            checksum_sha256: checksum,
        });
    }

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

    let checksum = file_sha256_hex(&save_path).await?;
    Ok(SeasonDownload {
        year,
        url,
        path: save_path,
        checksum_sha256: checksum,
    })
}

pub async fn process_and_insert_season(
    path: &PathBuf,
    season: i32,
    batch_id: Option<i64>,
    pool: &Pool<Postgres>,
) -> Result<usize> {
    ensure_raw_pbp_table(pool).await?;
    clear_raw_pbp_for_season(pool, season).await?;

    let file = StdFile::open(path)
        .with_context(|| format!("Failed opening parquet file: {}", path.display()))?;
    let reader = SerializedFileReader::new(file)
        .with_context(|| format!("Failed parsing parquet file: {}", path.display()))?;
    let row_iter = reader.get_row_iter(None)?;

    let mut batch: Vec<RawPbpRow> = Vec::with_capacity(1000);
    let mut total_count = 0;
    let mut skipped_count = 0;
    let mut source_row_number: i32 = 1;

    for row_result in row_iter {
        let row = row_result.with_context(|| {
            format!(
                "Failed reading parquet row {} from {}",
                source_row_number,
                path.display()
            )
        })?;
        if let Some(raw_row) = to_raw_pbp_row(row, season, batch_id, source_row_number) {
            batch.push(raw_row);
        } else {
            skipped_count += 1;
        }
        if batch.len() >= 1000 {
            insert_raw_pbp_batch(pool, &batch).await?;
            total_count += batch.len();
            batch.clear();
        }
        source_row_number += 1;
    }

    if !batch.is_empty() {
        insert_raw_pbp_batch(pool, &batch).await?;
        total_count += batch.len();
    }

    if skipped_count > 0 {
        eprintln!(
            "⚠️  Skipped {} rows in season {} due to missing game_id/play_id",
            skipped_count, season
        );
    }

    Ok(total_count)
}

pub async fn insert_raw_pbp_batch(pool: &Pool<Postgres>, rows: &[RawPbpRow]) -> Result<()> {
    let mut query_builder: QueryBuilder<Postgres> = QueryBuilder::new(
        "INSERT INTO raw.raw_nflverse_pbp (
            batch_id,
            game_id,
            play_id,
            season,
            week,
            posteam,
            defteam,
            source_row_number,
            payload
        ) ",
    );

    query_builder.push_values(rows, |mut b, row| {
        b.push_bind(row.batch_id)
            .push_bind(&row.game_id)
            .push_bind(&row.play_id)
            .push_bind(row.season)
            .push_bind(row.week)
            .push_bind(&row.posteam)
            .push_bind(&row.defteam)
            .push_bind(row.source_row_number)
            .push_bind(sqlx::types::Json(&row.payload));
    });

    let query = query_builder.build();
    query.execute(pool).await?;

    Ok(())
}

pub async fn get_raw_pbp_row_count(pool: &Pool<Postgres>) -> Result<i64> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM raw.raw_nflverse_pbp")
        .fetch_one(pool)
        .await?;
    Ok(row.0)
}

pub async fn begin_raw_ingest_batch(
    pool: &Pool<Postgres>,
    download: &SeasonDownload,
) -> Result<i64> {
    let source_file = download
        .path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("play_by_play.parquet")
        .to_string();
    let source_version = download.year.to_string();
    let metadata = format!(
        r#"{{"season":{},"status":"started","ingest_tool":"service-rust","target_table":"raw.raw_nflverse_pbp"}}"#,
        download.year
    );

    let row: (i64,) = sqlx::query_as(
        "INSERT INTO raw.raw_ingest_batch (
            source_system,
            dataset_name,
            source_url,
            source_file,
            source_version,
            source_checksum,
            metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING id",
    )
    .bind("nflverse")
    .bind("pbp")
    .bind(&download.url)
    .bind(source_file)
    .bind(source_version)
    .bind(&download.checksum_sha256)
    .bind(metadata)
    .fetch_one(pool)
    .await
    .context("Failed to create raw_ingest_batch row")?;

    Ok(row.0)
}

pub async fn complete_raw_ingest_batch(
    pool: &Pool<Postgres>,
    batch_id: i64,
    row_count: i64,
    processed_rows: i64,
    status: &str,
    error: Option<&str>,
) -> Result<()> {
    let escaped_error = error
        .unwrap_or("")
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    let metadata = format!(
        r#"{{"status":"{}","processed_rows":{},"finished_at":"{}","error":"{}"}}"#,
        status,
        processed_rows,
        chrono::Utc::now().to_rfc3339(),
        escaped_error
    );

    sqlx::query(
        "UPDATE raw.raw_ingest_batch
            SET row_count = $1,
                metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
          WHERE id = $3",
    )
    .bind(row_count)
    .bind(metadata)
    .bind(batch_id)
    .execute(pool)
    .await
    .context("Failed to update raw_ingest_batch row")?;

    Ok(())
}

async fn clear_raw_pbp_for_season(pool: &Pool<Postgres>, season: i32) -> Result<()> {
    sqlx::query("DELETE FROM raw.raw_nflverse_pbp WHERE season = $1")
        .bind(season)
        .execute(pool)
        .await?;
    Ok(())
}

async fn ensure_raw_pbp_table(pool: &Pool<Postgres>) -> Result<()> {
    let row: (Option<String>,) = sqlx::query_as("SELECT to_regclass('raw.raw_nflverse_pbp')::text")
        .fetch_one(pool)
        .await?;
    if row.0.is_none() {
        anyhow::bail!(
            "raw.raw_nflverse_pbp does not exist. Run Django migrations on the target database first."
        );
    }
    Ok(())
}

fn to_raw_pbp_row(
    row: Row,
    season_fallback: i32,
    batch_id: Option<i64>,
    source_row_number: i32,
) -> Option<RawPbpRow> {
    let payload_map = row_to_json_map(row);

    let game_id = value_as_text(payload_map.get("game_id"))?;
    let play_id = normalize_play_id(value_as_text(payload_map.get("play_id"))?);
    let season = value_as_i32(payload_map.get("season")).or(Some(season_fallback));
    let week = value_as_i32(payload_map.get("week"));
    let posteam = value_as_text(payload_map.get("posteam"));
    let defteam = value_as_text(payload_map.get("defteam"));
    let payload = serde_json::Value::Object(payload_map);

    Some(RawPbpRow {
        batch_id,
        game_id,
        play_id,
        season,
        week,
        posteam,
        defteam,
        source_row_number,
        payload,
    })
}

fn row_to_json_map(row: Row) -> serde_json::Map<String, serde_json::Value> {
    if let serde_json::Value::Object(map) = row.to_json_value() {
        map
    } else {
        let mut payload = serde_json::Map::new();
        payload.insert(
            "row_string".to_string(),
            serde_json::Value::String(row.to_string()),
        );
        payload
    }
}

fn value_as_text(value: Option<&serde_json::Value>) -> Option<String> {
    match value {
        Some(serde_json::Value::String(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Some(serde_json::Value::Number(n)) => Some(n.to_string()),
        Some(serde_json::Value::Bool(b)) => Some(b.to_string()),
        Some(serde_json::Value::Null) | None => None,
        Some(other) => Some(other.to_string()),
    }
}

fn value_as_i32(value: Option<&serde_json::Value>) -> Option<i32> {
    match value {
        Some(serde_json::Value::Number(n)) => {
            if let Some(v) = n.as_i64() {
                return i32::try_from(v).ok();
            }
            n.as_f64().and_then(|v| i32::try_from(v as i64).ok())
        }
        Some(serde_json::Value::String(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return None;
            }
            if let Ok(v) = trimmed.parse::<i32>() {
                return Some(v);
            }
            if let Ok(v) = trimmed.parse::<f64>() {
                return i32::try_from(v as i64).ok();
            }
            None
        }
        _ => None,
    }
}

fn normalize_play_id(play_id: String) -> String {
    let trimmed = play_id.trim();
    if let Ok(v) = trimmed.parse::<i64>() {
        return v.to_string();
    }
    if let Ok(v) = trimmed.parse::<f64>() {
        if (v.fract() - 0.0).abs() < f64::EPSILON {
            return (v as i64).to_string();
        }
    }
    trimmed.to_string()
}

async fn file_sha256_hex(path: &PathBuf) -> Result<String> {
    let mut file = File::open(path)
        .await
        .with_context(|| format!("Failed opening file for checksum: {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let bytes_read = file.read(&mut buffer).await?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    let checksum = format!("{:x}", hasher.finalize());
    Ok(checksum)
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn test_normalize_play_id() {
        assert_eq!(normalize_play_id("12345".to_string()), "12345");
        assert_eq!(normalize_play_id("12345.0".to_string()), "12345");
        assert_eq!(normalize_play_id("  98 ".to_string()), "98");
    }

    #[test]
    fn test_value_as_i32() {
        assert_eq!(
            value_as_i32(Some(&serde_json::Value::String("2024".into()))),
            Some(2024)
        );
        assert_eq!(value_as_i32(Some(&serde_json::json!(2025))), Some(2025));
        assert_eq!(value_as_i32(Some(&serde_json::json!(2026.0))), Some(2026));
        assert_eq!(value_as_i32(Some(&serde_json::Value::Null)), None);
    }
}
