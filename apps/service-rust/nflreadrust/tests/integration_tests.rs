use nflreadrust::{insert_raw_pbp_batch, RawPbpRow};
use sqlx::postgres::PgPoolOptions;
use sqlx::Pool;
use sqlx::Postgres;
use std::sync::{Mutex, OnceLock};

fn schema_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

async fn ensure_raw_table(pool: &Pool<Postgres>) {
    let _guard = schema_lock()
        .lock()
        .expect("Failed acquiring schema setup lock");

    sqlx::query("CREATE SCHEMA IF NOT EXISTS raw")
        .execute(pool)
        .await
        .expect("Failed creating raw schema");
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS raw.raw_nflverse_pbp (
            id BIGSERIAL PRIMARY KEY,
            batch_id BIGINT NULL,
            game_id TEXT NOT NULL,
            play_id TEXT NOT NULL,
            season INTEGER NULL,
            week INTEGER NULL,
            posteam TEXT NULL,
            defteam TEXT NULL,
            source_row_number INTEGER NULL,
            payload JSONB NOT NULL,
            ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
    )
    .execute(pool)
    .await
    .expect("Failed creating raw.raw_nflverse_pbp");
}

fn test_db_url() -> String {
    std::env::var("TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .unwrap_or_else(|_| "postgres://admin:password@localhost:5433/nfl_data".to_string())
}

#[tokio::test]
async fn test_database_insert_raw_pbp_flow() {
    let db_url = test_db_url();
    let pool = PgPoolOptions::new()
        .connect(&db_url)
        .await
        .expect("Failed to connect to Docker DB - is it running?");

    ensure_raw_table(&pool).await;

    let raw_row = RawPbpRow {
        batch_id: Some(123),
        game_id: "TEST_GAME_001".to_string(),
        play_id: "99999".to_string(),
        season: Some(2025),
        week: Some(1),
        posteam: Some("TEST_HOME".to_string()),
        defteam: Some("TEST_AWAY".to_string()),
        source_row_number: 1,
        payload: serde_json::json!({
            "game_id": "TEST_GAME_001",
            "play_id": "99999",
            "posteam": "TEST_HOME",
            "epa": 4.5
        }),
    };

    insert_raw_pbp_batch(&pool, &[raw_row])
        .await
        .expect("Raw insert failed");

    let row: (String, String, f64) = sqlx::query_as(
        "SELECT
            game_id,
            play_id,
            (payload->>'epa')::double precision
         FROM raw.raw_nflverse_pbp
         WHERE game_id = 'TEST_GAME_001'
         LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .expect("Fetch failed");

    assert_eq!(row.0, "TEST_GAME_001");
    assert_eq!(row.1, "99999");
    assert_eq!(row.2, 4.5);

    sqlx::query("DELETE FROM raw.raw_nflverse_pbp WHERE game_id = 'TEST_GAME_001'")
        .execute(&pool)
        .await
        .expect("Cleanup failed");
}

#[tokio::test]
async fn test_insert_multiple_rows() {
    let db_url = test_db_url();
    let pool = PgPoolOptions::new().connect(&db_url).await.unwrap();

    ensure_raw_table(&pool).await;

    let rows = vec![
        RawPbpRow {
            batch_id: Some(7),
            game_id: "TEST_GAME_MULTI".to_string(),
            play_id: "1".to_string(),
            season: Some(2024),
            week: Some(1),
            posteam: Some("A".to_string()),
            defteam: Some("B".to_string()),
            source_row_number: 1,
            payload: serde_json::json!({"game_id":"TEST_GAME_MULTI","play_id":"1"}),
        },
        RawPbpRow {
            batch_id: Some(7),
            game_id: "TEST_GAME_MULTI".to_string(),
            play_id: "2".to_string(),
            season: Some(2024),
            week: Some(1),
            posteam: Some("A".to_string()),
            defteam: Some("B".to_string()),
            source_row_number: 2,
            payload: serde_json::json!({"game_id":"TEST_GAME_MULTI","play_id":"2"}),
        },
    ];
    insert_raw_pbp_batch(&pool, &rows).await.unwrap();

    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM raw.raw_nflverse_pbp WHERE game_id = 'TEST_GAME_MULTI'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count.0, 2);

    sqlx::query("DELETE FROM raw.raw_nflverse_pbp WHERE game_id = 'TEST_GAME_MULTI'")
        .execute(&pool)
        .await
        .unwrap();
}
