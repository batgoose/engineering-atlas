"""Celery tasks for gridstream operations."""

from __future__ import annotations

import time
from io import StringIO
from typing import Any

from celery import shared_task
from django.core.management import call_command
from django.utils import timezone


class _LiveOutput:
    """
    StringIO-compatible stream that periodically flushes captured output to
    SyncJobRun.output so the admin hub can show live progress during long tasks.
    """

    def __init__(self, run_id: int | None, flush_interval: float = 4.0):
        self._buf = StringIO()
        self._run_id = run_id
        self._flush_interval = flush_interval
        self._last_flush: float = 0.0

    def write(self, s: str) -> int:
        result = self._buf.write(s)
        if self._run_id and time.monotonic() - self._last_flush >= self._flush_interval:
            self._flush_to_db()
        return result

    def flush(self) -> None:
        pass  # Django calls this; timing is managed internally

    def getvalue(self) -> str:
        return self._buf.getvalue()

    def _flush_to_db(self) -> None:
        from gridstream.models import SyncJobRun  # local import avoids circular

        try:
            output = self._buf.getvalue().strip()
            SyncJobRun.objects.filter(id=self._run_id).update(output=output[-12000:])
            self._last_flush = time.monotonic()
        except Exception:
            pass


@shared_task(bind=True)
def run_management_command(
    self,
    command: str,
    kwargs: dict[str, Any] | None = None,
    label: str | None = None,
    preview: str | None = None,
    run_id: int | None = None,
) -> dict[str, Any]:
    """Run a Django management command and capture stdout/stderr."""
    safe_kwargs = kwargs or {}
    live = _LiveOutput(run_id)
    started_at = timezone.now()
    status = "success"

    try:
        call_command(command, stdout=live, stderr=live, **safe_kwargs)
    except SystemExit as exc:
        status = "error"
        live.write(f"\nSystemExit: {exc}\n")
    except Exception as exc:  # pragma: no cover - defensive
        status = "error"
        live.write(f"\nError: {exc}\n")

    output = live.getvalue().strip()
    max_chars = 12000
    if len(output) > max_chars:
        output = output[-max_chars:]

    finished_at = timezone.now()

    # Write final status directly to DB so it's persisted even if the admin
    # hub poller misses the Celery result (e.g. user navigated away).
    if run_id:
        try:
            from gridstream.models import SyncJobRun  # local import avoids circular

            SyncJobRun.objects.filter(id=run_id).update(
                status=(
                    SyncJobRun.STATUS_SUCCESS
                    if status == "success"
                    else SyncJobRun.STATUS_ERROR
                ),
                output=output,
                finished_at=finished_at,
            )
        except Exception:
            pass

    return {
        "action": label or command,
        "command": preview or command,
        "status": status,
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "output": output,
    }
