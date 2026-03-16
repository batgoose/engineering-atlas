package espn

import (
	"strconv"
	"strings"

	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/events"
)

// scoreboard -> GameContext + GameUpdate

// EventToGameContext maps an espn event to GameContext
func EventToGameContext(ev Event, season, week int, seasonType string) events.GameContext {
	comp := ev.Competitions[0]

	home, away := splitCompetitors(comp.Competitors)

	gc := events.GameContext{
		GameID:     ev.ID,
		Season:     season,
		Week:       week,
		SeasonType: seasonType,
		GameDate:   ev.Date,
		HomeTeam:   teamToInfo(home),
		AwayTeam:   teamToInfo(away),

		// venue
		VenueName: comp.Venue.FullName,
		VenueCity: comp.Venue.Address.City,
		IsIndoor:  comp.Venue.Indoor,

		// status
		Status:    mapGameState(ev.Status),
		Quarter:   ev.Status.Period,
		Clock:     ev.Status.DisplayClock,
		HomeScore: mustInt(home.Score),
		AwayScore: mustInt(away.Score),
	}

	// surface
	if comp.Venue.Grass {
		gc.Surface = "grass"
	} else {
		gc.Surface = "turf"
	}

	// game note (for example "Super Bowl LX")
	if len(comp.Notes) > 0 {
		gc.GameNote = comp.Notes[0].Headline
	}

	// odds
	if len(comp.Odds) > 0 {
		o := comp.Odds[0]
		spread := o.Spread
		total := o.OverUnder
		gc.Spread = &spread
		gc.Total = &total
		if o.HomeTeamOdds != nil {
			ml := o.HomeTeamOdds.Moneyline
			gc.HomeMoneyline = &ml
		}
		if o.AwayTeamOdds != nil {
			ml := o.AwayTeamOdds.Moneyline
			gc.AwayMoneyline = &ml
		}
	}

	// broadcast
	if len(comp.Broadcasts) > 0 {
		gc.BroadcastNames = comp.Broadcasts[0].Names
		if len(gc.BroadcastNames) > 0 {
			gc.Network = gc.BroadcastNames[0]
		}
	}

	// weather
	if ev.Weather != nil {
		gc.Temperature = &ev.Weather.Temperature
		gc.WeatherDesc = ev.Weather.DisplayValue
		cid := mustIntStr(ev.Weather.ConditionID)
		gc.ConditionID = &cid
	}

	// team records
	for _, r := range home.Records {
		if r.Type == "total" {
			gc.HomeTeam.Record = r.Summary
		}
	}
	for _, r := range away.Records {
		if r.Type == "total" {
			gc.AwayTeam.Record = r.Summary
		}
	}

	return gc
}

// EventToGameUpdate pulls live state from an espn event
func EventToGameUpdate(ev Event) events.GameUpdate {
	comp := ev.Competitions[0]
	home, away := splitCompetitors(comp.Competitors)

	gu := events.GameUpdate{
		Status:    mapGameState(ev.Status),
		Quarter:   ev.Status.Period,
		Clock:     ev.Status.DisplayClock,
		HomeScore: mustInt(home.Score),
		AwayScore: mustInt(away.Score),
	}

	// odds can shift during game
	if len(comp.Odds) > 0 {
		o := comp.Odds[0]
		spread := o.Spread
		total := o.OverUnder
		gu.Spread = &spread
		gu.Total = &total
	}

	return gu
}

// EventToStatsUpdate pulls leader stats from an espn event
func EventToStatsUpdate(ev Event) []events.StatsUpdate {
	comp := ev.Competitions[0]
	var updates []events.StatsUpdate

	for _, c := range comp.Competitors {
		su := events.StatsUpdate{
			Team: c.Team.Abbreviation,
		}
		for _, lc := range c.Leaders {
			if len(lc.Leaders) == 0 {
				continue
			}
			l := lc.Leaders[0]
			cat := mapLeaderCategory(lc.Name)
			if cat == "" {
				continue
			}
			su.Leaders = append(su.Leaders, events.StatLeader{
				Category:     cat,
				PlayerName:   l.Athlete.FullName,
				PlayerID:     l.Athlete.ID,
				HeadshotURL:  l.Athlete.Headshot,
				Jersey:       l.Athlete.Jersey,
				Position:     l.Athlete.Position.Abbreviation,
				DisplayValue: l.DisplayValue,
			})
		}
		if len(su.Leaders) > 0 {
			updates = append(updates, su)
		}
	}

	return updates
}

// plays -> PlayEvent

// PlayToEvent maps an espn play into PlayEvent with drive context
func PlayToEvent(p Play, teamMap map[string]string, driveNum, drivePlays, driveYards int, driveTime string) events.PlayEvent {
	possession := ""
	if id := p.Start.Team.ID; id != "" {
		if abbr, ok := teamMap[id]; ok {
			possession = abbr
		}
	}

	return events.PlayEvent{
		Down:          p.Start.Down,
		Distance:      p.Start.Distance,
		YardLine:      p.Start.YardsToEndzone,
		DownDistText:  p.Start.DownDistanceText,
		Possession:    possession,
		PlayType:      normalizePlayType(p.Type.Text),
		YardsGained:   p.StatYardage,
		Description:   p.Text,
		ShortDesc:     p.ShortText,
		IsScoringPlay: p.ScoringPlay,
		IsTurnover:    isTurnover(p),
		HomeScore:     p.HomeScore,
		AwayScore:     p.AwayScore,
		EndDown:       p.End.Down,
		EndDistance:   p.End.Distance,
		EndYardLine:   p.End.YardsToEndzone,
		DriveNumber:   driveNum,
		DrivePlays:    drivePlays,
		DriveYards:    driveYards,
		DriveTime:     driveTime,
	}
}

// DriveToEvents maps an espn drive into start/end events
func DriveToEvents(d DriveData, driveNum int) (events.DriveEvent, events.DriveEvent) {
	start := events.DriveEvent{
		DriveNumber:   driveNum,
		Team:          d.Team.Abbreviation,
		StartQuarter:  d.Start.Period.Number,
		StartClock:    d.Start.Clock.DisplayValue,
		StartYardLine: d.Start.YardLine,
	}

	end := events.DriveEvent{
		DriveNumber: driveNum,
		Team:        d.Team.Abbreviation,
		Result:      strings.ToLower(d.Result),
		TotalYards:  d.Yards,
		PlayCount:   d.OffensivePlays,
		TimeElapsed: d.TimeElapsed.DisplayValue,
		IsScore:     d.IsScore,
	}

	return start, end
}

// ScoringPlayToEvent maps an espn scoring play into ScoringEvent
func ScoringPlayToEvent(sp ScoringPlay) events.ScoringEvent {
	return events.ScoringEvent{
		ScoreType:   mapScoreType(sp.ScoringType.Abbreviation),
		Description: sp.Text,
		Team:        sp.Team.Abbreviation,
		Quarter:     sp.Period.Number,
		Clock:       sp.Clock.DisplayValue,
		HomeScore:   sp.HomeScore,
		AwayScore:   sp.AwayScore,
	}
}

// helpers

func splitCompetitors(competitors []Competitor) (home, away Competitor) {
	for _, c := range competitors {
		switch c.HomeAway {
		case "home":
			home = c
		case "away":
			away = c
		}
	}
	return
}

func teamToInfo(c Competitor) events.TeamInfo {
	return events.TeamInfo{
		Abbreviation: c.Team.Abbreviation,
		DisplayName:  c.Team.DisplayName,
		ESPNID:       c.Team.ID,
		Color:        c.Team.Color,
		AltColor:     c.Team.AlternateColor,
		LogoURL:      c.Team.Logo,
	}
}

func mapGameState(s Status) string {
	switch s.Type.State {
	case "pre":
		return "scheduled"
	case "in":
		if s.Type.Name == "STATUS_HALFTIME" {
			return "halftime"
		}
		if s.Type.Name == "STATUS_END_PERIOD" {
			return "end_period"
		}
		return "in_progress"
	case "post":
		// overtime when period is above 4
		if s.Period > 4 {
			return "final_ot"
		}
		return "final"
	default:
		return "scheduled"
	}
}

func mapLeaderCategory(espnName string) string {
	switch espnName {
	case "passingLeader":
		return "passing"
	case "rushingLeader":
		return "rushing"
	case "receivingLeader":
		return "receiving"
	default:
		return ""
	}
}

func normalizePlayType(espnType string) string {
	t := strings.ToLower(espnType)
	switch {
	case strings.Contains(t, "rush"):
		return "run"
	case strings.Contains(t, "pass") && strings.Contains(t, "reception"):
		return "pass"
	case strings.Contains(t, "pass") && strings.Contains(t, "incompletion"):
		return "pass"
	case strings.Contains(t, "sack"):
		return "pass" // sack is a pass play
	case strings.Contains(t, "punt"):
		return "punt"
	case strings.Contains(t, "kickoff"):
		return "kickoff"
	case strings.Contains(t, "field goal"):
		return "field_goal"
	case strings.Contains(t, "extra point"):
		return "extra_point"
	case strings.Contains(t, "two-point") || strings.Contains(t, "two point"):
		return "two_point_attempt"
	case strings.Contains(t, "kneel"):
		return "qb_kneel"
	case strings.Contains(t, "spike"):
		return "qb_spike"
	case strings.Contains(t, "penalty"):
		return "no_play"
	default:
		return t
	}
}

func mapScoreType(abbr string) string {
	switch strings.ToUpper(abbr) {
	case "TD":
		return "TD"
	case "FG":
		return "FG"
	case "PAT", "XP":
		return "PAT"
	case "2PT", "CONV":
		return "2PT"
	case "SF", "SAF":
		return "SFTY"
	default:
		return abbr
	}
}

func isTurnover(p Play) bool {
	t := strings.ToLower(p.Type.Text)
	desc := strings.ToLower(p.Text)
	return strings.Contains(t, "interception") ||
		strings.Contains(t, "fumble") ||
		(strings.Contains(desc, "fumble") && strings.Contains(desc, "recovered by"))
}

func mustInt(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

func mustIntStr(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
