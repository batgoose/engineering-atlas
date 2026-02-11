use anyhow::{Context, Result};
use chrono::Datelike;
use nflreadrust::{download_season, process_and_insert_season};
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;
use std::env;

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

    let start_year = 1999;
    let current_year = chrono::Utc::now().year();

    println!(
        "🚀 Starting Archive Sequence: {} to Present ({})",
        start_year, current_year
    );

    for year in start_year..=current_year {
        println!("\n------------------------------------------------");
        println!("🏈 Checking NFL Season {}...", year);

        match download_season(year).await {
            Ok(path) => {
                if let Err(e) = process_and_insert_season(&path, &pool).await {
                    eprintln!("❌ DB Error {}: {}", year, e);
                } else {
                    println!("🎉 Verified {}.", year);
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