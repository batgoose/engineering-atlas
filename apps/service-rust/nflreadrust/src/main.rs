use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;
use chrono::Datelike;
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

    // 1999 is the start of reliable play-by-play data in nflverse
    let start_year = 1999;
    
    // Dynamically get the current year
    let current_year = chrono::Utc::now().year();

    println!("🚀 Starting Archive Sequence: {} to Present ({})", start_year, current_year);

    for year in start_year..=current_year {
        println!("\n------------------------------------------------");
        println!("🏈 Checking NFL Season {}...", year);
        
        match download_season(year).await {
            Ok(path) => {
                // If download succeeds, insert it
                if let Err(e) = process_and_insert_season(&path, &pool).await {
                    eprintln!("❌ DB Error {}: {}", year, e);
                } else {
                    println!("🎉 Verified {}.", year);
                }
            },
            Err(e) => {
                // This handles "future" years gracefully (asking for 2026 in March 2026)
                if e.to_string().contains("404") {
                     println!("Example: Season {} data not published yet.", year);
                } else {
                     eprintln!("❌ Download Error {}: {}", year, e);
                }
            }
        }
        
        // Slight delay to be polite to gitHub
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    
    println!("\n✅ Archive complete.");
    Ok(())
}