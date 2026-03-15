"""
Admin hub UI.
"""

from __future__ import annotations
import json
from dataclasses import dataclass
from typing import Any
from celery.result import AsyncResult
from django.contrib.auth.decorators import login_required, user_passes_test
from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.http import require_http_methods
from .models import (
    DraftMockDraft,
    Player,
    PlayerRAS,
    PlayerTransaction,
    SyncJobRun,
    Team,
)
from .tasks import run_management_command

# Action registry


@dataclass(frozen=True)
class AdminAction:
    key: str
    label: str
    description: str
    command: str
    season_type: str | None = None
    supports: tuple[str, ...] = ()
    fixed_kwargs: dict[str, Any] | None = None


ACTIONS: dict[str, AdminAction] = {
    # Full pipeline
    "sync_nightly_full": AdminAction(
        key="sync_nightly_full",
        label="Sync Nightly — Full",
        description="Full nightly pipeline: players, games, stats, analytics.",
        command="sync_nightly",
        season_type="int",
        supports=("dry_run", "include_otc", "active_players_only"),
    ),
    # Roster & contract sources
    "sync_rosters": AdminAction(
        key="sync_rosters",
        label="Sync Rosters",
        description="Update team assignments, jersey numbers, and roster status.",
        command="sync_rosters",
        season_type="int",
        supports=("dry_run",),
    ),
    "sync_otc_contracts": AdminAction(
        key="sync_otc_contracts",
        label="Sync OTC Contracts",
        description="Scrape per-year contract details from OverTheCap.",
        command="sync_otc_contracts",
        season_type=None,
        supports=("dry_run", "since_days"),
    ),
    "sync_spotrac": AdminAction(
        key="sync_spotrac",
        label="Sync Spotrac Transactions",
        description="Ingest official roster moves from Spotrac (calendar year).",
        command="sync_spotrac_transactions",
        season_type="int",
        supports=("dry_run",),
    ),
    "sync_spotrac_quick": AdminAction(
        key="sync_spotrac_quick",
        label="Sync Spotrac (Global Only)",
        description="Fast Spotrac check: global all-transactions page only (~2 requests).",
        command="sync_spotrac_transactions",
        season_type="int",
        supports=("dry_run",),
        fixed_kwargs={"global_only": True},
    ),
    "sync_ourlads": AdminAction(
        key="sync_ourlads",
        label="Sync Ourlads FA Tracker",
        description="Refresh offseason free-agent tracker from Ourlads (calendar year).",
        command="sync_ourlads_free_agent_tracker",
        season_type="int",
        supports=("dry_run",),
    ),
    "sync_ourlads_depth_charts": AdminAction(
        key="sync_ourlads_depth_charts",
        label="Sync Ourlads Depth Charts",
        description="Pull current team depth chart slots from Ourlads (all 32 teams).",
        command="sync_ourlads_depth_charts",
        season_type=None,
        supports=("dry_run",),
    ),
    # Transaction pipeline
    "sync_pending_transactions": AdminAction(
        key="sync_pending_transactions",
        label="Process Pending Transactions",
        description="OTC contracts + Ourlads team pages for all unhandled PlayerTransactions.",
        command="sync_pending_transactions",
        season_type=None,
        supports=("dry_run",),
    ),
    # Player ratings & awards
    "sync_madden_ratings": AdminAction(
        key="sync_madden_ratings",
        label="Sync Madden Ratings",
        description="Sync Madden NFL player ratings from Madden data sources.",
        command="sync_madden_ratings",
        season_type="list",
        supports=("dry_run",),
    ),
    # Game & stats sources
    "sync_espn_games": AdminAction(
        key="sync_espn_games",
        label="Sync ESPN Games",
        description="Refresh ESPN game summaries, boxscores, and odds.",
        command="sync_espn_games",
        season_type="int",
        supports=("dry_run",),
    ),
    "import_depth_charts": AdminAction(
        key="import_depth_charts",
        label="Import Depth Charts",
        description="Pull nflverse depth chart releases into raw tables.",
        command="import_nflverse_depth_charts",
        season_type="list",
        supports=("dry_run",),
    ),
    "import_snap_counts": AdminAction(
        key="import_snap_counts",
        label="Import Snap Counts",
        description="Pull nflverse snap count releases into raw tables.",
        command="import_nflverse_snap_counts",
        season_type="list",
        supports=("dry_run",),
    ),
    "sync_dvoa_ratings": AdminAction(
        key="sync_dvoa_ratings",
        label="Sync DVOA Ratings",
        description="Sync team DVOA metrics from FTN.",
        command="sync_dvoa_ratings",
        season_type="list",
        supports=("dry_run",),
    ),
    "sync_ff_rankings": AdminAction(
        key="sync_ff_rankings",
        label="Sync Fantasy Rankings",
        description="Sync FantasyPros ECR weekly rankings from DynastyProcess.",
        command="sync_ff_rankings",
        season_type="list",
        supports=("dry_run",),
    ),
    # Draft & prospect sources
    "sync_big_board_rankings": AdminAction(
        key="sync_big_board_rankings",
        label="Sync Big Board Rankings",
        description="Sync per-scout big board rankings from NFLMockDraftDatabase.",
        command="sync_big_board_rankings",
        season_type="int",
        supports=("dry_run",),
    ),
    "sync_mock_drafts": AdminAction(
        key="sync_mock_drafts",
        label="Sync Mock Drafts",
        description="Sync mock draft picks from NFLMockDraftDatabase.",
        command="sync_mock_drafts",
        season_type="int",
        supports=("dry_run",),
    ),
    "sync_nflmockdraftdb_profiles": AdminAction(
        key="sync_nflmockdraftdb_profiles",
        label="Sync NFLMDB Profiles",
        description="Sync minimal prospect profiles from NFLMockDraftDatabase.",
        command="sync_nflmockdraftdb_profiles",
        season_type="int",
        supports=("dry_run",),
    ),
    "sync_ras_scores": AdminAction(
        key="sync_ras_scores",
        label="Sync RAS Scores",
        description="Sync Relative Athletic Scores from ras.football.",
        command="sync_ras_scores",
        season_type=None,
        supports=("dry_run",),
    ),
    # Health check always last
    "check_data_health": AdminAction(
        key="check_data_health",
        label="Check Data Health",
        description="Run the data freshness report. Surfaces stale datasets.",
        command="check_data_health",
    ),
    # Targeted shortcut
    "sync_nightly_players": AdminAction(
        key="sync_nightly_players",
        label="Sync Nightly — Players Only",
        description="Fast re-sync: player bio, roster, transactions, depth/snap only.",
        command="sync_nightly",
        season_type="int",
        supports=("dry_run", "include_otc", "active_players_only"),
        fixed_kwargs={"skip_phases": "games,stats,analytics,health"},
    ),
}

# Preset bundles
PRESETS: dict[str, dict] = {
    "offseason": {
        "key": "offseason",
        "label": "Offseason Sync",
        "description": "Spotrac · Rosters · Process pending (OTC + Ourlads) · Madden · Big board · Mock drafts · RAS · Health",
        "color": "copper",
        "actions": [
            "sync_spotrac",
            "sync_rosters",
            "sync_pending_transactions",
            "sync_ourlads_depth_charts",
            "sync_big_board_rankings",
            "sync_mock_drafts",
            "sync_nflmockdraftdb_profiles",
            "sync_ras_scores",
            "check_data_health",
        ],
    },
    "transaction_watch": {
        "key": "transaction_watch",
        "label": "Transaction Watch",
        "description": "Quick check: global Spotrac page · process any new pending transactions (OTC + Ourlads)",
        "color": "green",
        "actions": [
            "sync_spotrac_quick",
            "sync_pending_transactions",
        ],
    },
    "health_check": {
        "key": "health_check",
        "label": "Health Check",
        "description": "Run data freshness report — surfaces stale tables, missing records, and sync gaps.",
        "color": "amber",
        "actions": ["check_data_health"],
    },
    "in_season": {
        "key": "in_season",
        "label": "In-Season Sync",
        "description": "Nightly full · ESPN games · Depth charts · Snap counts · FF rankings · DVOA · Health",
        "color": "cyan",
        "actions": [
            "sync_nightly_full",
            "sync_espn_games",
            "import_depth_charts",
            "import_snap_counts",
            "sync_ff_rankings",
            "sync_dvoa_ratings",
            "check_data_health",
        ],
    },
}


# Helpers


def _build_command(action, cleaned):
    kwargs = {}
    if action.fixed_kwargs:
        kwargs.update(action.fixed_kwargs)
    season = cleaned.get("season")
    if season is not None and action.season_type:
        kwargs["season"] = [season] if action.season_type == "list" else season
    if "dry_run" in action.supports and cleaned.get("dry_run"):
        kwargs["dry_run"] = True
    if "include_otc" in action.supports and cleaned.get("include_otc"):
        kwargs["include_otc"] = True
    if "active_players_only" in action.supports and cleaned.get("active_players_only"):
        kwargs["active_players_only"] = True
    if "since_days" in action.supports:
        since_days = cleaned.get("since_days")
        if since_days:
            kwargs["since_days"] = int(since_days)
    skip_phases = cleaned.get("skip_phases")
    if skip_phases and action.command == "sync_nightly":
        kwargs["skip_phases"] = skip_phases
    return action.command, kwargs


def _format_command_preview(command, kwargs):
    parts = ["python", "manage.py", command]
    for key, value in kwargs.items():
        if isinstance(value, bool):
            if value:
                parts.append("--" + key.replace("_", "-"))
        elif key == "season" and isinstance(value, list):
            for s in value:
                parts.append("--season " + str(s))
        else:
            parts.append("--" + key.replace("_", "-") + " " + str(value))
    return " ".join(parts)


_TASK_STALE_MINUTES = 90


def _sync_run_from_celery(run):
    if run.status not in (SyncJobRun.STATUS_QUEUED, SyncJobRun.STATUS_STARTED):
        return False
    if not run.task_id:
        return True
    result = AsyncResult(run.task_id)
    if result.ready():
        data = result.result if isinstance(result.result, dict) else {}
        run.status = data.get("status", "error" if result.failed() else "success")
        run.output = data.get("output", "")
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "output", "finished_at"])
        return False
    if result.state == "STARTED":
        age = (timezone.now() - run.started_at).total_seconds() / 60
        if age > _TASK_STALE_MINUTES:
            run.status = SyncJobRun.STATUS_ERROR
            run.output = (run.output or "") + (
                "\n[admin-hub] Task marked lost after "
                + str(int(age))
                + "m with no completion signal."
            )
            run.finished_at = timezone.now()
            run.save(update_fields=["status", "output", "finished_at"])
            return False
    return True


def _run_to_dict(run):
    return {
        "run_id": run.id,
        "action_key": run.action_key,
        "status": run.status,
        "command_preview": run.command_preview,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "output": run.output or "",
    }


def _require_staff(view_fn):
    for dec in reversed(
        [
            login_required(login_url="/admin/login/"),
            user_passes_test(lambda u: u.is_staff, login_url="/admin/login/"),
        ]
    ):
        view_fn = dec(view_fn)
    return view_fn


# Views


@_require_staff
@require_http_methods(["GET"])
def admin_hub(request):
    last_runs = {}
    active_runs = {}
    for key in ACTIONS:
        run = SyncJobRun.objects.filter(action_key=key).order_by("-started_at").first()
        if not run:
            continue
        still_running = _sync_run_from_celery(run)
        d = _run_to_dict(run)
        last_runs[key] = d
        if still_running:
            active_runs[key] = d
    initial_run = SyncJobRun.objects.order_by("-started_at").first()
    initial_run_data = _run_to_dict(initial_run) if initial_run else None
    actions_list = [
        {
            "key": a.key,
            "label": a.label,
            "description": a.description,
            "season_type": a.season_type,
            "supports": list(a.supports),
        }
        for a in ACTIONS.values()
    ]
    # Build frontend base URL from the request so it works across dev/prod hosts
    frontend_url = f"{request.scheme}://{request.get_host()}".replace(
        "api.localhost", "app.localhost"
    ).replace(":8000", ":3000")
    context = {
        "actions": list(ACTIONS.values()),
        "actions_json": json.dumps(actions_list),
        "presets_json": json.dumps(list(PRESETS.values())),
        "last_runs_json": json.dumps(last_runs),
        "active_runs_json": json.dumps(active_runs),
        "initial_run_json": json.dumps(initial_run_data),
        "frontend_url": frontend_url,
    }
    return render(request, "gridstream/admin_hub.html", context)


@require_http_methods(["POST"])
def admin_hub_run(request):
    if not (request.user.is_authenticated and request.user.is_staff):
        return JsonResponse({"error": "forbidden"}, status=403)
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "invalid JSON"}, status=400)
    action_key = data.get("action_key")
    if action_key not in ACTIONS:
        return JsonResponse({"error": "unknown action: " + str(action_key)}, status=400)
    action = ACTIONS[action_key]
    cleaned = {
        "season": data.get("season"),
        "dry_run": bool(data.get("dry_run")),
        "include_otc": bool(data.get("include_otc")),
        "active_players_only": bool(data.get("active_players_only")),
        "skip_phases": data.get("skip_phases") or "",
        "since_days": data.get("since_days"),
    }
    command, kwargs = _build_command(action, cleaned)
    preview = _format_command_preview(command, kwargs)
    run = SyncJobRun.objects.create(
        action_key=action_key,
        command_preview=preview,
        status=SyncJobRun.STATUS_QUEUED,
    )
    task = run_management_command.delay(
        command, kwargs, label=action.label, preview=preview, run_id=run.id
    )
    run.task_id = task.id
    run.status = SyncJobRun.STATUS_STARTED
    run.save(update_fields=["task_id", "status"])
    return JsonResponse(
        {"run_id": run.id, "task_id": task.id, "command_preview": preview}
    )


@require_http_methods(["GET"])
def admin_hub_status(request):
    if not (request.user.is_authenticated and request.user.is_staff):
        return JsonResponse({"error": "forbidden"}, status=403)
    run_id = request.GET.get("run_id")
    if not run_id:
        return JsonResponse({"error": "run_id required"}, status=400)
    try:
        run = SyncJobRun.objects.get(id=run_id)
    except SyncJobRun.DoesNotExist:
        return JsonResponse({"error": "not found"}, status=404)
    _sync_run_from_celery(run)
    return JsonResponse(_run_to_dict(run))


@require_http_methods(["POST"])
def admin_hub_cancel(request):
    if not (request.user.is_authenticated and request.user.is_staff):
        return JsonResponse({"error": "forbidden"}, status=403)
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "invalid JSON"}, status=400)
    run_id = data.get("run_id")
    if not run_id:
        return JsonResponse({"error": "run_id required"}, status=400)
    try:
        run = SyncJobRun.objects.get(id=run_id)
        if run.task_id:
            AsyncResult(run.task_id).revoke(terminate=True)
        run.status = SyncJobRun.STATUS_REVOKED
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "finished_at"])
    except SyncJobRun.DoesNotExist:
        pass
    return JsonResponse({"ok": True})


@require_http_methods(["GET"])
def admin_hub_stats(request):
    """Return live DB stats and recent sync job history for the admin hub dashboard."""
    if not (request.user.is_authenticated and request.user.is_staff):
        return JsonResponse({"error": "forbidden"}, status=403)

    # ── DB counts (all on the `nfl` DB) ───────────────────────────────────
    pending_tx = PlayerTransaction.objects.filter(is_handled=False).count()
    active_players = Player.objects.using("nfl").filter(is_active=True).count()
    total_players = Player.objects.using("nfl").count()
    active_teams = Team.objects.using("nfl").filter(is_active=True).count()
    ras_with_score = PlayerRAS.objects.filter(has_ras=True).count()
    ras_prospects = PlayerRAS.objects.filter(is_prospect=True, draft_year=2026).count()
    mock_drafts = DraftMockDraft.objects.count()

    # ── Celery worker ping ─────────────────────────────────────────────────
    celery_up = False
    try:
        from celery import current_app

        inspector = current_app.control.inspect(timeout=1.5)
        pong = inspector.ping()
        celery_up = bool(pong)
    except Exception:
        celery_up = False

    # ── Recent sync job runs ───────────────────────────────────────────────
    recent_runs_qs = SyncJobRun.objects.order_by("-started_at").values(
        "id", "action_key", "status", "started_at", "finished_at", "command_preview"
    )[:20]
    recent_runs = []
    for r in recent_runs_qs:
        duration_s = None
        if r["started_at"] and r["finished_at"]:
            duration_s = int((r["finished_at"] - r["started_at"]).total_seconds())
        recent_runs.append(
            {
                "id": r["id"],
                "action_key": r["action_key"],
                "label": (
                    ACTIONS[r["action_key"]].label
                    if r["action_key"] in ACTIONS
                    else r["action_key"]
                ),
                "status": r["status"],
                "started_at": (
                    r["started_at"].strftime("%Y-%m-%d %H:%M")
                    if r["started_at"]
                    else None
                ),
                "duration_s": duration_s,
                "command_preview": r["command_preview"],
            }
        )

    return JsonResponse(
        {
            "db": {
                "pending_transactions": pending_tx,
                "active_players": active_players,
                "total_players": total_players,
                "active_teams": active_teams,
                "ras_with_score": ras_with_score,
                "ras_prospects": ras_prospects,
                "mock_drafts": mock_drafts,
            },
            "celery_up": celery_up,
            "recent_runs": recent_runs,
        }
    )
