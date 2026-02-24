"""
Management command: bootstrap_nfl_v2

Deterministic staged runner for bootstrapping the NFL v2 database.

Stages:
1) migrate
2) raw ingest
3) core transforms
4) qa report

This command intentionally runs existing commands in a fixed order. Because the
current import/seed commands are hardcoded to the `nfl` alias, this command
temporarily routes that alias to the requested target database during staged
execution.
"""

from __future__ import annotations

import json
import hashlib
import shlex
import shutil
import subprocess
import time
from contextlib import contextmanager
from copy import deepcopy
from io import StringIO
from pathlib import Path
from urllib.parse import quote_plus

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connections
from django.utils import timezone


class Command(BaseCommand):
    help = (
        "Bootstrap NFL v2 in deterministic stages: migrate -> raw ingest -> "
        "core transforms -> QA report."
    )

    CORE_TRANSFORM_COMMANDS = [
        ("seed_teams", {}),
        ("materialize_plays", {}),
        ("seed_venues", {}),
        ("seed_players", {}),
        ("enrich_players", {}),
        ("seed_social_accounts", {}),
        ("sync_rosters", {}),
        ("import_games", {}),
        ("normalize_venues", {}),
        ("import_drives", {}),
        ("import_plays", {}),
        ("import_player_game_stats", {}),
        ("import_team_game_stats", {}),
        ("materialize_player_game_stats", {}),
        ("materialize_team_game_stats", {}),
        ("import_nflverse_standings", {}),
        ("import_nflverse_draft_picks", {}),
        ("import_nflverse_draft_values", {}),
        ("import_nflverse_trades", {}),
    ]

    def add_arguments(self, parser):
        parser.add_argument(
            "--database",
            default="nfl_v2",
            help="Target database alias (default: nfl_v2)",
        )
        parser.add_argument(
            "--skip-migrate",
            action="store_true",
            help="Skip migrate stage.",
        )
        parser.add_argument(
            "--skip-raw-ingest",
            action="store_true",
            help="Skip raw ingest stage.",
        )
        parser.add_argument(
            "--skip-core-transforms",
            action="store_true",
            help="Skip core transform commands.",
        )
        parser.add_argument(
            "--skip-qa",
            action="store_true",
            help="Skip check_data_health QA stage.",
        )
        parser.add_argument(
            "--raw-ingest-cmd",
            default="",
            help=(
                "Shell command for raw ingest stage. If omitted and raw plays table "
                "is empty, default is docker compose service-rust."
            ),
        )
        parser.add_argument(
            "--include-espn-sync",
            action="store_true",
            help="Append sync_espn_games --full after core transforms.",
        )
        parser.add_argument(
            "--qa-json-out",
            default="",
            help="Optional path to write QA JSON output.",
        )
        parser.add_argument(
            "--strict-qa",
            action="store_true",
            help="Fail on warnings (WARN/STALE/DRIFT) in addition to hard failures.",
        )

    def handle(self, *args, **options):
        database_alias = options["database"]
        skip_migrate = options["skip_migrate"]
        skip_raw_ingest = options["skip_raw_ingest"]
        skip_core_transforms = options["skip_core_transforms"]
        skip_qa = options["skip_qa"]
        raw_ingest_cmd = options["raw_ingest_cmd"]
        include_espn_sync = options["include_espn_sync"]
        qa_json_out = options["qa_json_out"]
        strict_qa = options["strict_qa"]

        if database_alias not in settings.DATABASES:
            available = ", ".join(sorted(settings.DATABASES.keys()))
            raise CommandError(
                f"Unknown database alias '{database_alias}'. Available: {available}"
            )

        self.stdout.write(self.style.MIGRATE_HEADING("\nNFL v2 Bootstrap"))
        self.stdout.write(f"Target database alias: {database_alias}")

        stage_results: list[dict] = []

        try:
            if skip_migrate:
                self._record_skipped(stage_results, "migrate", "flag --skip-migrate")
            else:
                self._run_stage(
                    stage_results,
                    "migrate",
                    lambda: self._run_migrate(database_alias),
                )

            with self._route_nfl_alias(database_alias):
                if skip_raw_ingest:
                    self._record_skipped(
                        stage_results,
                        "raw_ingest",
                        "flag --skip-raw-ingest",
                    )
                else:
                    self._run_stage(
                        stage_results,
                        "raw_ingest",
                        lambda: self._run_raw_ingest(database_alias, raw_ingest_cmd),
                    )

                if skip_core_transforms:
                    self._record_skipped(
                        stage_results,
                        "core_transforms",
                        "flag --skip-core-transforms",
                    )
                else:
                    self._run_stage(
                        stage_results,
                        "core_transforms",
                        lambda: self._run_core_transforms(include_espn_sync),
                    )

                if skip_qa:
                    self._record_skipped(stage_results, "qa_report", "flag --skip-qa")
                else:
                    self._run_stage(
                        stage_results,
                        "qa_report",
                        lambda: self._run_qa_report(qa_json_out, strict_qa),
                    )
        except Exception:
            self._print_stage_summary(stage_results)
            raise

        self._print_stage_summary(stage_results)
        self.stdout.write(self.style.SUCCESS("\nbootstrap_nfl_v2 complete."))

    # ── Stage runners ─────────────────────────────────────────────────────

    def _run_migrate(self, database_alias):
        self.stdout.write(f"Running migrations for database '{database_alias}'...")
        call_command(
            "migrate",
            database=database_alias,
            interactive=False,
            stdout=self.stdout,
            stderr=self.stderr,
        )
        return {"detail": f"migrate --database={database_alias}"}

    def _run_raw_ingest(self, database_alias, raw_ingest_cmd):
        raw_stats_before = self._get_raw_play_stats()
        table_exists = raw_stats_before["table_exists"]
        row_count_before = raw_stats_before["row_count"]
        raw_batch_count_before = self._get_raw_batch_count()

        if row_count_before > 0 and not raw_ingest_cmd:
            self.stdout.write(
                self.style.WARNING(
                    f"Raw PBP already present ({row_count_before:,} rows). "
                    "Skipping ingest command."
                )
            )
            return {"detail": f"raw pbp already populated ({row_count_before:,} rows)"}

        command = raw_ingest_cmd.strip()
        if not command:
            command = self._default_raw_ingest_command(database_alias)
            if not command:
                hint = (
                    "Provide --raw-ingest-cmd or pre-load raw PBP in the target DB. "
                    "Example: docker compose run --rm "
                    f"-e DATABASE_URL={self._database_url_for_alias(database_alias)} "
                    "service-rust"
                )
                if not table_exists:
                    raise CommandError(
                        "Raw PBP table does not exist in target DB. " + hint
                    )
                raise CommandError(
                    "Raw PBP table is empty and no default ingest command is "
                    "available. " + hint
                )

        self.stdout.write(f"Running raw ingest command:\n  {command}")
        self._run_shell_command(command)

        raw_stats_after = self._get_raw_play_stats()
        row_count_after = raw_stats_after["row_count"]
        if row_count_after == 0:
            raise CommandError(
                "Raw ingest stage completed but raw.raw_nflverse_pbp is still empty."
            )

        inserted_rows = max(0, row_count_after - row_count_before)
        raw_batch_count_after = self._get_raw_batch_count()
        if (
            raw_batch_count_before is not None
            and raw_batch_count_after is not None
            and raw_batch_count_after == raw_batch_count_before
        ):
            self._insert_fallback_raw_batch(
                command=command,
                source_url=self._guess_source_url(command),
                row_count=inserted_rows,
            )

        self.stdout.write(
            self.style.SUCCESS(
                "Raw ingest complete: "
                f"{row_count_before:,} -> {row_count_after:,} raw.raw_nflverse_pbp rows"
            )
        )
        return {"detail": f"raw pbp rows {row_count_before:,} -> {row_count_after:,}"}

    def _run_core_transforms(self, include_espn_sync):
        commands = list(self.CORE_TRANSFORM_COMMANDS)
        if include_espn_sync:
            commands.append(("sync_espn_games", {"full": True}))
            commands.append(("import_espn_probabilities", {}))

        total = len(commands)
        for idx, (command_name, kwargs) in enumerate(commands, start=1):
            self.stdout.write(f"[{idx}/{total}] {command_name}")
            call_command(
                command_name,
                stdout=self.stdout,
                stderr=self.stderr,
                **kwargs,
            )

        return {"detail": f"ran {total} command(s)"}

    def _run_qa_report(self, qa_json_out, strict_qa):
        buffer = StringIO()
        call_command(
            "check_data_health",
            json=True,
            stdout=buffer,
            stderr=self.stderr,
        )

        payload_text = buffer.getvalue().strip()
        if not payload_text:
            raise CommandError("check_data_health produced no JSON output.")

        try:
            payload = json.loads(payload_text)
        except json.JSONDecodeError as exc:
            raise CommandError(
                f"Could not parse check_data_health JSON output: {exc}"
            ) from exc

        checks = payload.get("checks", [])
        critical_statuses = {"MISSING", "EMPTY"}
        warning_statuses = {"WARN", "STALE", "DRIFT"}

        critical = [c for c in checks if c.get("status") in critical_statuses]
        warnings = [c for c in checks if c.get("status") in warning_statuses]

        report = {
            "generated_at": timezone.now().isoformat(),
            "checks": checks,
            "suggestions": payload.get("suggestions", []),
            "critical_count": len(critical),
            "warning_count": len(warnings),
        }

        if qa_json_out:
            out_path = Path(qa_json_out)
            if not out_path.is_absolute():
                out_path = Path.cwd() / out_path
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            self.stdout.write(
                self.style.SUCCESS(f"QA report written to {out_path.as_posix()}")
            )

        self.stdout.write(
            f"QA summary: {len(checks)} checks, "
            f"{len(critical)} critical, {len(warnings)} warnings"
        )

        if critical:
            labels = ", ".join(c.get("name", "<unknown>") for c in critical)
            raise CommandError(f"QA failed (critical): {labels}")

        if strict_qa and warnings:
            labels = ", ".join(c.get("name", "<unknown>") for c in warnings)
            raise CommandError(f"QA failed in strict mode (warnings): {labels}")

        return {"detail": f"{len(checks)} checks ({len(critical)} critical)"}

    # ── Helpers ────────────────────────────────────────────────────────────

    def _run_stage(self, stage_results, stage_name, stage_fn):
        self.stdout.write(self.style.MIGRATE_HEADING(f"\n== {stage_name} =="))
        started = time.monotonic()
        result_detail = ""
        try:
            result = stage_fn() or {}
            result_detail = result.get("detail", "")
        except Exception as exc:
            elapsed = time.monotonic() - started
            stage_results.append(
                {
                    "stage": stage_name,
                    "status": "failed",
                    "elapsed": elapsed,
                    "detail": str(exc),
                }
            )
            raise

        elapsed = time.monotonic() - started
        stage_results.append(
            {
                "stage": stage_name,
                "status": "ok",
                "elapsed": elapsed,
                "detail": result_detail,
            }
        )

    def _record_skipped(self, stage_results, stage_name, reason):
        self.stdout.write(self.style.WARNING(f"Skipping {stage_name}: {reason}"))
        stage_results.append(
            {
                "stage": stage_name,
                "status": "skipped",
                "elapsed": 0.0,
                "detail": reason,
            }
        )

    def _print_stage_summary(self, stage_results):
        if not stage_results:
            return

        self.stdout.write(self.style.MIGRATE_HEADING("\nStage Summary"))
        for item in stage_results:
            stage = item["stage"]
            status = item["status"]
            elapsed = item["elapsed"]
            detail = item.get("detail", "")
            if status == "ok":
                style = self.style.SUCCESS
                tag = "OK"
            elif status == "skipped":
                style = self.style.WARNING
                tag = "SKIP"
            else:
                style = self.style.ERROR
                tag = "FAIL"
            line = f"[{tag}] {stage} ({elapsed:.1f}s)"
            if detail:
                line += f" - {detail}"
            self.stdout.write(style(line))

    def _get_raw_play_stats(self):
        with connections["nfl"].cursor() as cursor:
            cursor.execute("SELECT to_regclass('raw.raw_nflverse_pbp')")
            table_ref = cursor.fetchone()[0]
            if not table_ref:
                return {"table_exists": False, "row_count": 0}

            cursor.execute("SELECT COUNT(*) FROM raw.raw_nflverse_pbp")
            row_count = cursor.fetchone()[0]
            return {"table_exists": True, "row_count": row_count}

    def _get_raw_batch_count(self):
        try:
            with connections["nfl"].cursor() as cursor:
                cursor.execute("SELECT to_regclass('raw.raw_ingest_batch')")
                table_ref = cursor.fetchone()[0]
                if not table_ref:
                    return None
                cursor.execute("SELECT COUNT(*) FROM raw.raw_ingest_batch")
                return int(cursor.fetchone()[0])
        except Exception:
            return None

    def _insert_fallback_raw_batch(self, command, source_url, row_count):
        fallback_checksum = hashlib.sha256(command.encode("utf-8")).hexdigest()
        metadata = {
            "status": "ok",
            "ingest_tool": "bootstrap_nfl_v2",
            "ingest_command": command,
            "note": "fallback batch metadata inserted by bootstrap runner",
        }
        with connections["nfl"].cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO raw.raw_ingest_batch (
                    source_system,
                    dataset_name,
                    source_url,
                    source_file,
                    source_version,
                    source_checksum,
                    row_count,
                    metadata
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                [
                    "bootstrap",
                    "pbp",
                    source_url,
                    command,
                    "",
                    fallback_checksum,
                    row_count,
                    json.dumps(metadata),
                ],
            )

    def _guess_source_url(self, command):
        if "service-rust" in command:
            return "https://github.com/nflverse/nflverse-data/releases/download/pbp"
        return ""

    def _default_raw_ingest_command(self, database_alias):
        if shutil.which("docker") is None:
            return ""
        repo_root = self._find_repo_root()
        if not (repo_root / "docker-compose.yml").exists():
            return ""

        database_url = self._database_url_for_alias(database_alias)
        return (
            "docker compose run --rm "
            f"-e DATABASE_URL={shlex.quote(database_url)} "
            "service-rust"
        )

    def _run_shell_command(self, command):
        repo_root = self._find_repo_root()
        completed = subprocess.run(
            command,
            shell=True,
            cwd=repo_root,
            check=False,
        )
        if completed.returncode != 0:
            raise CommandError(
                f"Shell command failed with exit code {completed.returncode}: {command}"
            )

    def _database_url_for_alias(self, alias):
        cfg = settings.DATABASES.get(alias, {})
        engine = str(cfg.get("ENGINE", ""))
        if "postgresql" not in engine:
            raise CommandError(
                f"Alias '{alias}' does not appear to be PostgreSQL (engine={engine})."
            )

        name = cfg.get("NAME", "")
        if not name:
            raise CommandError(f"Alias '{alias}' has no database NAME configured.")

        user = str(cfg.get("USER", "") or "")
        password = str(cfg.get("PASSWORD", "") or "")
        host = str(cfg.get("HOST", "") or "localhost")
        port = str(cfg.get("PORT", "") or "5432")

        auth = ""
        if user:
            auth = quote_plus(user)
            if password:
                auth += ":" + quote_plus(password)
            auth += "@"

        return f"postgresql://{auth}{host}:{port}/{name}"

    def _find_repo_root(self):
        current = Path(__file__).resolve()
        for parent in current.parents:
            if (parent / "docker-compose.yml").exists():
                return parent
        return Path.cwd()

    @contextmanager
    def _route_nfl_alias(self, target_alias):
        """
        Temporarily route the `nfl` alias to the requested target alias.

        Existing commands are built against `using("nfl")` and connections["nfl"].
        This lets us run them against nfl_v2 without touching every command yet.
        """
        if target_alias == "nfl":
            yield
            return

        if "nfl" not in settings.DATABASES:
            raise CommandError("settings.DATABASES has no 'nfl' alias to route.")
        if target_alias not in settings.DATABASES:
            raise CommandError(f"settings.DATABASES missing alias '{target_alias}'.")

        original_nfl_cfg = deepcopy(settings.DATABASES["nfl"])
        target_cfg = deepcopy(settings.DATABASES[target_alias])
        conn = connections["nfl"]
        original_conn_settings = deepcopy(conn.settings_dict)

        conn.close()
        settings.DATABASES["nfl"] = target_cfg
        connections.databases["nfl"] = target_cfg
        conn.settings_dict = deepcopy(target_cfg)
        try:
            yield
        finally:
            conn.close()
            settings.DATABASES["nfl"] = original_nfl_cfg
            connections.databases["nfl"] = original_nfl_cfg
            conn.settings_dict = original_conn_settings
