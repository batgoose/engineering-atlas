use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
pub struct PlayRecord {
    pub play_id: f64,
    pub game_id: String,
    pub old_game_id: Option<String>,
    pub drive: Option<f64>,

    pub home_team: String,
    pub away_team: String,
    pub posteam: Option<String>,
    pub posteam_type: Option<String>,
    pub defteam: Option<String>,

    pub game_date: Option<String>,
    pub season_type: String,
    pub week: i32,
    pub stadium: Option<String>,
    pub weather: Option<String>,
    pub surface: Option<String>,
    pub roof: Option<String>,

    pub qtr: Option<i32>,
    pub quarter_seconds_remaining: Option<f32>,
    pub half_seconds_remaining: Option<f32>,
    pub game_seconds_remaining: Option<f32>,
    pub down: Option<i32>,
    pub ydstogo: Option<i32>,
    pub yardline_100: Option<i32>,
    pub side_of_field: Option<String>,
    pub shotgun: i32,
    pub no_huddle: i32,

    pub play_type: Option<String>,
    pub yards_gained: Option<f32>,
    pub air_yards: Option<f32>,
    pub yards_after_catch: Option<f32>,
    pub epa: Option<f32>,
    pub wpa: Option<f32>,
    pub success: Option<f32>,

    pub passer_player_id: Option<String>,
    pub passer_player_name: Option<String>,
    pub rusher_player_id: Option<String>,
    pub rusher_player_name: Option<String>,
    pub receiver_player_id: Option<String>,
    pub receiver_player_name: Option<String>,

    pub touchdown: Option<f32>,
    pub interception: Option<f32>,
    pub fumble: Option<f32>,
    pub sack: Option<f32>,
    pub complete_pass: Option<f32>,
    pub pass_touchdown: Option<f32>,
    pub rush_touchdown: Option<f32>,

    pub field_goal_result: Option<String>,
    pub kick_distance: Option<f32>,
    pub punt_blocked: Option<f32>,

    pub penalty: Option<f32>,
    pub penalty_type: Option<String>,
    pub penalty_yards: Option<f32>,
}
