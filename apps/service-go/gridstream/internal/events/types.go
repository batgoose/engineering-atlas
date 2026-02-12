package events

import "encoding/json"

// event envelope for websocket messages

// event type constants
const (
	TypeGameContext  = "game_context"  // sent once on connect or game start
	TypeGameUpdate   = "game_update"   // status/score/possession changes
	TypePlay         = "play"          // individual play result
	TypeScoringPlay  = "scoring_play"  // scoring event (subset of plays)
	TypeDriveStart   = "drive_start"   // new drive begins
	TypeDriveEnd     = "drive_end"     // drive concludes
	TypeStatsUpdate  = "stats_update"  // player stat line changed
	TypeGameStart    = "game_start"    // game kicked off
	TypeGameEnd      = "game_end"      // game final
	TypeWeather      = "weather"       // weather update
	TypeError        = "error"         // error message
	TypePing         = "ping"          // keepalive
)

// Envelope wraps websocket messages with routing metadata
type Envelope struct {
	Type      string          `json:"type"`
	GameID    string          `json:"gameId"`
	Timestamp int64           `json:"ts"`
	Payload   json.RawMessage `json:"payload"`
}

// NewEnvelope builds an envelope with a marshaled payload
func NewEnvelope(eventType, gameID string, ts int64, payload any) (Envelope, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return Envelope{}, err
	}
	return Envelope{
		Type:      eventType,
		GameID:    gameID,
		Timestamp: ts,
		Payload:   data,
	}, nil
}

// MustEnvelope is like NewEnvelope but panics on marshal errors
func MustEnvelope(eventType, gameID string, ts int64, payload any) Envelope {
	e, err := NewEnvelope(eventType, gameID, ts, payload)
	if err != nil {
		panic("events: failed to marshal envelope payload: " + err.Error())
	}
	return e
}

// payload types

// TeamInfo is the team block used in GameContext
type TeamInfo struct {
	Abbreviation string `json:"abbreviation"`
	DisplayName  string `json:"displayName"`
	ESPNID       string `json:"espnId"`
	Color        string `json:"color"`
	AltColor     string `json:"altColor"`
	LogoURL      string `json:"logoUrl"`
	Record       string `json:"record,omitempty"`
	Coach        string `json:"coach,omitempty"`
	StartingQB   string `json:"startingQb,omitempty"`
}

// GameContext is sent on connect or game start
// includes richer mostly static game metadata
type GameContext struct {
	GameID     string   `json:"gameId"`
	Season     int      `json:"season"`
	Week       int      `json:"week"`
	SeasonType string   `json:"seasonType"` // REG, POST, PRE
	GameNote   string   `json:"gameNote"`   // "Super Bowl LX"
	GameDate   string   `json:"gameDate"`
	GameTime   string   `json:"gameTime,omitempty"`
	HomeTeam   TeamInfo `json:"homeTeam"`
	AwayTeam   TeamInfo `json:"awayTeam"`

	// venue
	VenueName string `json:"venueName"`
	VenueCity string `json:"venueCity"`
	IsIndoor  bool   `json:"isIndoor"`
	Surface   string `json:"surface,omitempty"`

	// weather for outdoor games
	Temperature  *int   `json:"temperature,omitempty"`
	WeatherDesc  string `json:"weatherDesc,omitempty"`
	WeatherWind  string `json:"weatherWind,omitempty"`
	ConditionID  *int   `json:"conditionId,omitempty"`

	// odds
	Spread        *float64 `json:"spread,omitempty"`
	Total         *float64 `json:"total,omitempty"`
	HomeMoneyline *int     `json:"homeMoneyline,omitempty"`
	AwayMoneyline *int     `json:"awayMoneyline,omitempty"`

	// broadcast
	Network        string   `json:"network,omitempty"`
	BroadcastNames []string `json:"broadcastNames,omitempty"`

	// current state for mid-game connects
	Status    string `json:"status"` // scheduled, in_progress, halftime, final, etc
	Quarter   int    `json:"quarter"`
	Clock     string `json:"clock"`
	HomeScore int    `json:"homeScore"`
	AwayScore int    `json:"awayScore"`
}

// GameUpdate is sent on status, score, or possession changes
type GameUpdate struct {
	Status     string `json:"status"`
	Quarter    int    `json:"quarter"`
	Clock      string `json:"clock"`
	HomeScore  int    `json:"homeScore"`
	AwayScore  int    `json:"awayScore"`
	Possession string `json:"possession,omitempty"` // team abbreviation

	// live odds can shift during the game
	Spread        *float64 `json:"spread,omitempty"`
	Total         *float64 `json:"total,omitempty"`
	HomeMoneyline *int     `json:"homeMoneyline,omitempty"`
	AwayMoneyline *int     `json:"awayMoneyline,omitempty"`
}

// PlayEvent is sent for each new play
type PlayEvent struct {
	// pre-snap situation
	Down         int    `json:"down"`
	Distance     int    `json:"distance"`
	YardLine     int    `json:"yardLine"` // yards to endzone
	DownDistText string `json:"downDistText"`
	Possession   string `json:"possession"` // team abbreviation

	// result
	PlayType      string `json:"playType"`
	YardsGained   int    `json:"yardsGained"`
	Description   string `json:"description"`
	ShortDesc     string `json:"shortDesc"`
	IsScoringPlay bool   `json:"isScoringPlay"`
	IsTurnover    bool   `json:"isTurnover"`

	// score after play
	HomeScore int `json:"homeScore"`
	AwayScore int `json:"awayScore"`

	// end state
	EndDown     int `json:"endDown,omitempty"`
	EndDistance  int `json:"endDistance,omitempty"`
	EndYardLine int `json:"endYardLine,omitempty"`

	// drive context
	DriveNumber int    `json:"driveNumber"`
	DrivePlays  int    `json:"drivePlays"`
	DriveYards  int    `json:"driveYards"`
	DriveTime   string `json:"driveTime,omitempty"`
}

// ScoringEvent is sent on scoring plays with extra detail
type ScoringEvent struct {
	ScoreType   string `json:"scoreType"` // TD, FG, PAT, 2PT, SFTY, D-TD
	Description string `json:"description"`
	Team        string `json:"team"`
	Quarter     int    `json:"quarter"`
	Clock       string `json:"clock"`
	HomeScore   int    `json:"homeScore"`
	AwayScore   int    `json:"awayScore"`
}

// DriveEvent is sent when a drive starts or ends
type DriveEvent struct {
	DriveNumber int    `json:"driveNumber"`
	Team        string `json:"team"`
	StartQuarter int   `json:"startQuarter,omitempty"`
	StartClock   string `json:"startClock,omitempty"`
	StartYardLine int  `json:"startYardLine,omitempty"`

	// end fields only used on drive_end
	Result     string `json:"result,omitempty"` // touchdown, punt, turnover, field_goal, etc
	TotalYards int    `json:"totalYards,omitempty"`
	PlayCount  int    `json:"playCount,omitempty"`
	TimeElapsed string `json:"timeElapsed,omitempty"`
	IsScore    bool   `json:"isScore,omitempty"`
}

// StatsUpdate is sent when player stat lines change
type StatsUpdate struct {
	Team    string       `json:"team"`
	Leaders []StatLeader `json:"leaders"`
}

// StatLeader is one leader entry in a category
type StatLeader struct {
	Category     string `json:"category"` // passing, rushing, receiving
	PlayerName   string `json:"playerName"`
	PlayerID     string `json:"playerId,omitempty"`
	HeadshotURL  string `json:"headshotUrl,omitempty"`
	Jersey       string `json:"jersey,omitempty"`
	Position     string `json:"position,omitempty"`
	DisplayValue string `json:"displayValue"` // "280 YDS, 2 TD"
}

// WeatherUpdate is sent for live weather changes
type WeatherUpdate struct {
	Temperature int    `json:"temperature"`
	Condition   string `json:"condition"`
	ConditionID int    `json:"conditionId"`
	Wind        string `json:"wind"`
	Humidity    int    `json:"humidity,omitempty"`
}

// ErrorEvent is sent when something fails
type ErrorEvent struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
