package espn

// scoreboard response
// site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard

// ScoreboardResponse is the top-level scoreboard json
type ScoreboardResponse struct {
	Leagues []League `json:"leagues"`
	Season  struct {
		Year int `json:"year"`
		Type int `json:"type"` // 1=pre, 2=reg, 3=post
	} `json:"season"`
	Week struct {
		Number int `json:"number"`
	} `json:"week"`
	Events []Event `json:"events"`
}

type League struct {
	Abbreviation string `json:"abbreviation"`
	Season       struct {
		Year int `json:"year"`
		Type struct {
			Type int `json:"type"`
		} `json:"type"`
	} `json:"season"`
}

// Event is one game on the scoreboard
type Event struct {
	ID           string        `json:"id"`
	Date         string        `json:"date"`
	Name         string        `json:"name"`      // "Seattle Seahawks at New England Patriots"
	ShortName    string        `json:"shortName"` // "SEA @ NE"
	Competitions []Competition `json:"competitions"`
	Status       Status        `json:"status"`
	Weather      *Weather      `json:"weather,omitempty"`
}

type Competition struct {
	ID          string       `json:"id"`
	Date        string       `json:"date"`
	Competitors []Competitor `json:"competitors"`
	Odds        []Odds       `json:"odds,omitempty"`
	Broadcasts  []Broadcast  `json:"broadcasts,omitempty"`
	Venue       Venue        `json:"venue"`
	Status      Status       `json:"status"`
	Notes       []Note       `json:"notes,omitempty"`
}

type Note struct {
	Type     string `json:"type"`
	Headline string `json:"headline"`
}

type Competitor struct {
	ID       string `json:"id"`
	HomeAway string `json:"homeAway"` // "home" or "away"
	Score    string `json:"score"`
	Team     Team   `json:"team"`
	Records  []struct {
		Type    string `json:"type"`
		Summary string `json:"summary"`
	} `json:"records"`
	Leaders    []LeaderCategory `json:"leaders,omitempty"`
	Linescores []struct {
		Value float64 `json:"value"`
	} `json:"linescores,omitempty"`
}

type Team struct {
	ID               string `json:"id"`
	Abbreviation     string `json:"abbreviation"`
	DisplayName      string `json:"displayName"`
	ShortDisplayName string `json:"shortDisplayName"`
	Location         string `json:"location"`
	Name             string `json:"name"`
	Color            string `json:"color"`
	AlternateColor   string `json:"alternateColor"`
	Logo             string `json:"logo"`
}

type LeaderCategory struct {
	Name    string   `json:"name"` // "passingLeader", "rushingLeader", "receivingLeader"
	Leaders []Leader `json:"leaders"`
}

type Leader struct {
	DisplayValue string  `json:"displayValue"` // "280 YDS, 2 TD"
	Athlete      Athlete `json:"athlete"`
}

type Athlete struct {
	ID       string `json:"id"`
	FullName string `json:"fullName"`
	Headshot string `json:"headshot"`
	Jersey   string `json:"jersey"`
	Position struct {
		Abbreviation string `json:"abbreviation"`
	} `json:"position"`
}

type Odds struct {
	Provider struct {
		Name string `json:"name"`
	} `json:"provider"`
	Details   string  `json:"details"`
	OverUnder float64 `json:"overUnder"`
	Spread    float64 `json:"spread"`
	// some responses include moneylines
	HomeTeamOdds *TeamOdds `json:"homeTeamOdds,omitempty"`
	AwayTeamOdds *TeamOdds `json:"awayTeamOdds,omitempty"`
}

type TeamOdds struct {
	Moneyline int `json:"moneyLine"`
}

type Broadcast struct {
	Names  []string `json:"names"`
	Market string   `json:"market"`
}

type Venue struct {
	ID       string `json:"id"`
	FullName string `json:"fullName"`
	Address  struct {
		City    string `json:"city"`
		State   string `json:"state"`
		Country string `json:"country"`
	} `json:"address"`
	Indoor  bool `json:"indoor"`
	Grass   bool `json:"grass"`
}

type Status struct {
	Clock        float64 `json:"clock"`
	DisplayClock string  `json:"displayClock"`
	Period       int     `json:"period"`
	Type         struct {
		ID        string `json:"id"`
		Name      string `json:"name"`      // STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_FINAL, etc
		State     string `json:"state"`     // pre, in, post
		Completed bool   `json:"completed"`
		Detail    string `json:"detail"`    // human-readable status text
	} `json:"type"`
}

type Weather struct {
	Temperature  int    `json:"temperature"`
	DisplayValue string `json:"displayValue"`
	ConditionID  string `json:"conditionId"`
}

// game summary response
// site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={id}

type SummaryResponse struct {
	Boxscore     *Boxscore      `json:"boxscore,omitempty"`
	Drives       *DrivesWrapper `json:"drives,omitempty"`
	ScoringPlays []ScoringPlay  `json:"scoringPlays,omitempty"`
	Leaders      []any          `json:"leaders,omitempty"`
	Header       *SummaryHeader `json:"header,omitempty"`
}

type SummaryHeader struct {
	ID           string        `json:"id"`
	Competitions []Competition `json:"competitions"`
	Season       struct {
		Year int `json:"year"`
		Type int `json:"type"`
	} `json:"season"`
	Week int `json:"week"`
}

type Boxscore struct {
	Teams   []BoxscoreTeam   `json:"teams"`
	Players []BoxscorePlayer `json:"players"`
}

type BoxscoreTeam struct {
	Team       Team              `json:"team"`
	Statistics []TeamBoxscoreStat `json:"statistics"`
}

type TeamBoxscoreStat struct {
	Name         string `json:"name"`
	DisplayValue string `json:"displayValue"`
}

type BoxscorePlayer struct {
	Team       Team                   `json:"team"`
	Statistics []PlayerStatCategory   `json:"statistics"`
}

type PlayerStatCategory struct {
	Name    string   `json:"name"` // "passing", "rushing", "receiving", "fumbles", "defensive", etc
	Labels  []string `json:"labels"`
	Athletes []PlayerStatLine `json:"athletes"`
}

type PlayerStatLine struct {
	Athlete Athlete  `json:"athlete"`
	Stats   []string `json:"stats"` // parallel to labels
}

// drives and plays

type DrivesWrapper struct {
	Current  *DriveData   `json:"current,omitempty"`
	Previous []DriveData  `json:"previous"`
}

type DriveData struct {
	ID          string `json:"id"`
	Description string `json:"description"` // "8 plays, 75 yards, 3:42"
	Team        struct {
		Abbreviation string `json:"abbreviation"`
	} `json:"team"`
	Start struct {
		Period struct {
			Number int `json:"number"`
		} `json:"period"`
		Clock struct {
			DisplayValue string `json:"displayValue"`
		} `json:"clock"`
		YardLine int `json:"yardLine"`
	} `json:"start"`
	End struct {
		Period struct {
			Number int `json:"number"`
		} `json:"period"`
		Clock struct {
			DisplayValue string `json:"displayValue"`
		} `json:"clock"`
		YardLine int `json:"yardLine"`
	} `json:"end"`
	TimeElapsed struct {
		DisplayValue string `json:"displayValue"`
	} `json:"timeElapsed"`
	Yards              int    `json:"yards"`
	IsScore            bool   `json:"isScore"`
	OffensivePlays     int    `json:"offensivePlays"`
	Result             string `json:"result"`             // "Touchdown", "Punt", "Fumble", etc
	ShortDisplayResult string `json:"shortDisplayResult"` // "TD", "PUNT", "FUM"
	Plays              []Play `json:"plays"`
}

type Play struct {
	ID       string `json:"id"`
	Type     struct {
		ID           string `json:"id"`
		Text         string `json:"text"`         // "Rush", "Pass Reception", etc
		Abbreviation string `json:"abbreviation"`
	} `json:"type"`
	Text                 string `json:"text"`      // full play description
	ShortText            string `json:"shortText"`
	HomeScore            int    `json:"homeScore"`
	AwayScore            int    `json:"awayScore"`
	Period               struct {
		Number int `json:"number"`
	} `json:"period"`
	Clock struct {
		Value        float64 `json:"value"`
		DisplayValue string  `json:"displayValue"`
	} `json:"clock"`
	ScoringPlay bool   `json:"scoringPlay"`
	Priority    bool   `json:"priority"`
	Wallclock   string `json:"wallclock"`
	Start       struct {
		Down             int    `json:"down"`
		Distance         int    `json:"distance"`
		YardLine         int    `json:"yardLine"`
		YardsToEndzone   int    `json:"yardsToEndzone"`
		DownDistanceText string `json:"downDistanceText"`
		Team             struct {
			ID string `json:"id"`
		} `json:"team"`
	} `json:"start"`
	End struct {
		Down           int `json:"down"`
		Distance       int `json:"distance"`
		YardLine       int `json:"yardLine"`
		YardsToEndzone int `json:"yardsToEndzone"`
		Team           struct {
			ID string `json:"id"`
		} `json:"team"`
	} `json:"end"`
	StatYardage int `json:"statYardage"`
	ScoringType struct {
		Name         string `json:"name"`
		Abbreviation string `json:"abbreviation"`
	} `json:"scoringType"`
}

type ScoringPlay struct {
	ID        string `json:"id"`
	Type      struct {
		Text         string `json:"text"`
		Abbreviation string `json:"abbreviation"`
	} `json:"type"`
	Text      string `json:"text"`
	HomeScore int    `json:"homeScore"`
	AwayScore int    `json:"awayScore"`
	Period    struct {
		Number int `json:"number"`
	} `json:"period"`
	Clock struct {
		DisplayValue string `json:"displayValue"`
	} `json:"clock"`
	Team struct {
		ID           string `json:"id"`
		Abbreviation string `json:"abbreviation"`
	} `json:"team"`
	ScoringType struct {
		Name         string `json:"name"`
		Abbreviation string `json:"abbreviation"`
	} `json:"scoringType"`
}
