use nflreadrust::{insert_batch, models::PlayRecord};
use sqlx::postgres::PgPoolOptions;

const DB_URL: &str = "postgres://admin:password@localhost:5433/nfl_data";

#[tokio::test]
async fn test_database_insert_read_flow() {
    
    let pool = PgPoolOptions::new()
        .connect(DB_URL)
        .await
        .expect("Failed to connect to Docker DB - is it running?");

    
    // We use a fake game_id so we don't clash with real data
    let mock_play = PlayRecord {
        play_id: 99999.0,
        game_id: "TEST_GAME_001".to_string(),
        home_team: "TEST_HOME".to_string(),
        away_team: "TEST_AWAY".to_string(),
        posteam: Some("TEST_HOME".to_string()),
        game_date: Some("2025-12-25".to_string()), 
        play_type: Some("pass".to_string()),
        yards_gained: Some(50.0),
        touchdown: Some(1.0),

        
        old_game_id: None,
        drive: None,
        posteam_type: None,
        defteam: None,
        season_type: "REG".to_string(),
        week: 1,
        stadium: None,
        weather: None,
        surface: None,
        roof: None,
        qtr: Some(4),
        quarter_seconds_remaining: None,
        half_seconds_remaining: None,
        game_seconds_remaining: None,
        down: Some(1),
        ydstogo: Some(10),
        yardline_100: Some(50),
        side_of_field: None,
        shotgun: 0,
        no_huddle: 0,
        air_yards: None,
        yards_after_catch: None,
        epa: Some(4.5),
        wpa: None,
        success: Some(1.0),
        passer_player_id: Some("00-12345".to_string()),
        passer_player_name: Some("Test QB".to_string()),
        rusher_player_id: None,
        rusher_player_name: None,
        receiver_player_id: None,
        receiver_player_name: None,
        interception: None,
        fumble: None,
        sack: None,
        complete_pass: Some(1.0),
        pass_touchdown: Some(1.0),
        rush_touchdown: None,
        field_goal_result: None,
        kick_distance: None,
        punt_blocked: None,
        penalty: None,
        penalty_type: None,
        penalty_yards: None,
    };

    
    insert_batch(&pool, &[mock_play])
        .await
        .expect("Insert failed");

    
    // FIX: We must use f32 because the DB column is 'REAL' (Float4)
    let row: (f32, String) = sqlx::query_as(
        "SELECT yards_gained, passer_player_name FROM plays WHERE game_id = 'TEST_GAME_001'",
    )
    .fetch_one(&pool)
    .await
    .expect("Fetch failed");

    
    assert_eq!(row.0, 50.0);
    assert_eq!(row.1, "Test QB");

    // 6. Cleanup (Optional, but polite)
    sqlx::query("DELETE FROM plays WHERE game_id = 'TEST_GAME_001'")
        .execute(&pool)
        .await
        .expect("Cleanup failed");
}

#[tokio::test]
async fn test_insert_idempotency() {
    let pool = PgPoolOptions::new().connect(DB_URL).await.unwrap();

    let mock_play = PlayRecord {
        play_id: 88888.0,
        game_id: "TEST_GAME_DUPE".to_string(),
        home_team: "A".to_string(),
        away_team: "B".to_string(),
        // ... (You can create a helper function to generate dummy structs to save space)
        season_type: "REG".to_string(),
        week: 1,
        // ... set defaults for everything else ...
        posteam: None,
        old_game_id: None,
        drive: None,
        posteam_type: None,
        defteam: None,
        game_date: None,
        stadium: None,
        weather: None,
        surface: None,
        roof: None,
        qtr: None,
        quarter_seconds_remaining: None,
        half_seconds_remaining: None,
        game_seconds_remaining: None,
        down: None,
        ydstogo: None,
        yardline_100: None,
        side_of_field: None,
        shotgun: 0,
        no_huddle: 0,
        play_type: None,
        yards_gained: None,
        air_yards: None,
        yards_after_catch: None,
        epa: None,
        wpa: None,
        success: None,
        passer_player_id: None,
        passer_player_name: None,
        rusher_player_id: None,
        rusher_player_name: None,
        receiver_player_id: None,
        receiver_player_name: None,
        touchdown: None,
        interception: None,
        fumble: None,
        sack: None,
        complete_pass: None,
        pass_touchdown: None,
        rush_touchdown: None,
        field_goal_result: None,
        kick_distance: None,
        punt_blocked: None,
        penalty: None,
        penalty_type: None,
        penalty_yards: None,
    };

    
    let result1 = insert_batch(&pool, &[mock_play.clone()]).await;
    assert!(result1.is_ok());

    let mock_play_copy = PlayRecord {
        play_id: 88888.0,
        game_id: "TEST_GAME_DUPE".to_string(),
        home_team: "A".to_string(),
        away_team: "B".to_string(),
        season_type: "REG".to_string(),
        week: 1,
        ..mock_play.clone() 
    };

    let result2 = insert_batch(&pool, &[mock_play_copy]).await;
    assert!(result2.is_ok());

    
    sqlx::query("DELETE FROM plays WHERE game_id = 'TEST_GAME_DUPE'")
        .execute(&pool)
        .await
        .unwrap();
}
