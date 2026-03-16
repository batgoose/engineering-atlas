"""
Gridstream API URL Configuration.

All endpoints are prefixed with /api/gridstream/ (configured in config/urls.py).

Endpoint map:
  GET  /seasons/                          — list all seasons
  GET  /seasons/current/                  — current active season

  GET  /teams/                            — all active teams
  GET  /teams/{abbr}/                     — team detail
  GET  /teams/{abbr}/roster/              — team roster
  GET  /teams/{abbr}/schedule/?season=    — team schedule
  GET  /teams/{abbr}/season-stats/        — per-season aggregate stats
  GET  /teams/{abbr}/game-log/?season=    — per-game results with box stats
  GET  /teams/{abbr}/dvoa/?season_type=   — DVOA history + latest snapshots
  GET  /teams/dvoa/?season=&season_type=  — league-wide team DVOA for a season
  GET  /teams/rankings/?season=&abbr=     — league/conf/div stat rankings

  GET  /players/                          — search/filter players
  GET  /players/{id}/                     — player profile
  GET  /players/{id}/gamelog/?season=      — player game log
  GET  /players/{id}/splits/?season=      — player stat splits

  GET  /games/?season=&week=&team=        — scoreboard / game list
  GET  /games/live/                       — live game hydration (WebSocket bridge)
  GET  /games/{id}/                       — game detail
  GET  /games/{id}/plays/?quarter=&down=  — play-by-play (cursor paginated)
  GET  /games/{id}/drives/                — drive summaries
  GET  /games/{id}/boxscore/              — player + team box scores

  GET  /standings/?season=                — division standings
  GET  /fantasy/leaders/?season=&week=    — fantasy leaderboard

  GET  /transactions/                     — recent roster moves
  GET  /venues/                           — all venues

  GET  /news/league/                      — league news feed (live proxy)
  GET  /news/team/{abbr}/                 — team news feed (live proxy)
  GET  /news/player/{espn_id}/            — player news feed (live proxy)
  GET  /news/articles/                    — persisted articles (DB-backed, filterable)

  GET  /playbooks/                        — simulation playbooks
  GET  /playbooks/{id}/entries/           — playbook plays

  GET  /draft/big-board/?season=          — multi-source prospect big board
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from . import views, news_proxy

router = DefaultRouter()
router.register(r"seasons", views.SeasonViewSet, basename="season")
router.register(r"teams", views.TeamViewSet, basename="team")
router.register(r"players", views.PlayerViewSet, basename="player")
router.register(r"games", views.GameViewSet, basename="game")
router.register(r"standings", views.StandingsViewSet, basename="standing")
router.register(
    r"fantasy/leaders", views.FantasyLeadersViewSet, basename="fantasy-leader"
)
router.register(r"transactions", views.TransactionViewSet, basename="transaction")
router.register(r"venues", views.VenueViewSet, basename="venue")
router.register(r"playbooks", views.PlaybookViewSet, basename="playbook")
router.register(r"draft", views.DraftViewSet, basename="draft")
router.register(r"news/articles", views.NewsArticleViewSet, basename="news-article")

urlpatterns = [
    # Router-registered viewsets
    path("", include(router.urls)),
    # News proxy endpoints (function-based views)
    path("news/league/", news_proxy.news_league, name="news-league"),
    path("news/team/<str:team_abbr>/", news_proxy.news_team, name="news-team"),
    path("news/player/<str:espn_id>/", news_proxy.news_player, name="news-player"),
]
