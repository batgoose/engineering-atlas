"""
Redzone API URL Configuration.

All endpoints are prefixed with /api/redzone/ (configured in config/urls.py).

Endpoint map:
  GET  /seasons/                          — list all seasons
  GET  /seasons/current/                  — current active season

  GET  /teams/                            — all active teams
  GET  /teams/{abbr}/                     — team detail
  GET  /teams/{abbr}/roster/              — team roster
  GET  /teams/{abbr}/schedule/?season=    — team schedule

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

  GET  /news/league/                      — league news feed
  GET  /news/team/{abbr}/                 — team news feed
  GET  /news/player/{espn_id}/            — player news feed

  GET  /playbooks/                        — simulation playbooks
  GET  /playbooks/{id}/entries/           — playbook plays
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

urlpatterns = [
    # Router-registered viewsets
    path("", include(router.urls)),
    # News proxy endpoints (function-based views)
    path("news/league/", news_proxy.news_league, name="news-league"),
    path("news/team/<str:team_abbr>/", news_proxy.news_team, name="news-team"),
    path("news/player/<str:espn_id>/", news_proxy.news_player, name="news-player"),
]
