use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;
// Import from our new library
use nflreadrust::{download_season, process_and_insert_season};

const DB_URL: &str = "postgres://admin:password@localhost:5433/nfl_data";

#[tokio::main]
async fn main() -> Result<()> {
    println!("🔌 Connecting to database at port 5433...");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(DB_URL)
        .await
        .context("Failed to connect to Postgres")?;
    println!("✅ Database connected.");

    let start_year = 2010;
    let end_year = 2023;

    for year in start_year..=end_year {
        println!("\n🏈 Processing NFL Season {}...", year);
        match download_season(year).await {
            Ok(path) => {
                if let Err(e) = process_and_insert_season(&path, &pool).await {
                    eprintln!("❌ DB Error {}: {}", year, e);
                } else {
                    println!("🎉 Finished {}.", year);
                }
            }
            Err(e) => eprintln!("❌ Download Error {}: {}", year, e),
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Ok(())
}
