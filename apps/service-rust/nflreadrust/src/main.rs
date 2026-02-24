use anyhow::{Context, Result};
use chrono::Datelike;
use nflreadrust::{
    begin_raw_ingest_batch, complete_raw_ingest_batch, download_season, get_raw_pbp_row_count,
    process_and_insert_season,
};
use sqlx::postgres::PgPoolOptions;
use std::env;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<()> {
    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://admin:password@localhost:5433/nfl_data".to_string());

    println!("🔌 Attempting connection: {}", database_url);

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&database_url)
        .await
        .context("Failed to connect to Postgres. Verify DATABASE_URL and network path.")?;

    println!("✅ Database connected successfully.");

    let current_year = chrono::Utc::now().year();
    let start_year = env::var("NFL_PBP_START_YEAR")
        .ok()
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(1999);
    let end_year = env::var("NFL_PBP_END_YEAR")
        .ok()
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(current_year);

    if start_year > end_year {
        anyhow::bail!(
            "Invalid year range: NFL_PBP_START_YEAR ({}) must be <= NFL_PBP_END_YEAR ({})",
            start_year,
            end_year
        );
    }

    println!(
        "🚀 Starting Archive Sequence: {} to {}",
        start_year, end_year
    );

    for year in start_year..=end_year {
        println!("\n------------------------------------------------");
        println!("🏈 Checking NFL Season {}...", year);

        match download_season(year).await {
            Ok(download) => {
                println!("📦 Source URL: {}", download.url);
                println!("🔐 SHA256: {}", download.checksum_sha256);

                let before_count = match get_raw_pbp_row_count(&pool).await {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!(
                            "⚠️  Could not read raw_nflverse_pbp row count before ingest: {}",
                            e
                        );
                        0
                    }
                };

                let batch_id = match begin_raw_ingest_batch(&pool, &download).await {
                    Ok(id) => Some(id),
                    Err(e) => {
                        eprintln!("⚠️  Raw batch metadata unavailable (continuing): {}", e);
                        None
                    }
                };

                match process_and_insert_season(&download.path, year, batch_id, &pool).await {
                    Err(e) => {
                        if let Some(id) = batch_id {
                            let _ = complete_raw_ingest_batch(
                                &pool,
                                id,
                                0,
                                0,
                                "failed",
                                Some(&e.to_string()),
                            )
                            .await;
                        }
                        eprintln!("❌ DB Error {}: {}", year, e);
                    }
                    Ok(processed_rows) => {
                        let after_count = match get_raw_pbp_row_count(&pool).await {
                            Ok(v) => v,
                            Err(e) => {
                                eprintln!(
                                "⚠️  Could not read raw_nflverse_pbp row count after ingest: {}",
                                e
                            );
                                before_count
                            }
                        };
                        let net_row_delta = after_count.saturating_sub(before_count);
                        println!(
                        "📊 Processed rows for {}: {} (net table delta: {}, raw_nflverse_pbp total: {})",
                        year, processed_rows, net_row_delta, after_count
                    );

                        if let Some(id) = batch_id {
                            if let Err(e) = complete_raw_ingest_batch(
                                &pool,
                                id,
                                i64::try_from(processed_rows).unwrap_or(i64::MAX),
                                i64::try_from(processed_rows).unwrap_or(i64::MAX),
                                "ok",
                                None,
                            )
                            .await
                            {
                                eprintln!("⚠️  Failed to finalize raw batch metadata: {}", e);
                            }
                        }
                        println!("🎉 Verified {}.", year);
                    }
                }
            }
            Err(e) => {
                if e.to_string().contains("404") {
                    println!("Notice: Season {} data not published yet.", year);
                } else {
                    eprintln!("❌ Download Error {}: {}", year, e);
                }
            }
        }

        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    println!("\n✅ Archive complete.");
    Ok(())
}
