from django.contrib import admin
from django.urls import path, include

from gridstream.admin_hub import (
    admin_hub,
    admin_hub_run,
    admin_hub_stats,
    admin_hub_status,
    admin_hub_cancel,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("admin-hub/", admin_hub, name="admin-hub"),
    path("admin-hub/run/", admin_hub_run, name="admin-hub-run"),
    path("admin-hub/status/", admin_hub_status, name="admin-hub-status"),
    path("admin-hub/cancel/", admin_hub_cancel, name="admin-hub-cancel"),
    path("admin-hub/stats/", admin_hub_stats, name="admin-hub-stats"),
    path("api/", include("core.urls")),
    path("api/gridstream/", include("gridstream.urls")),
]
