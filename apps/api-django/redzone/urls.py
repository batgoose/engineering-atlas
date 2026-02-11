from django.urls import path, include
from rest_framework.routers import DefaultRouter

# ViewSets will be added in Phase 1.4
router = DefaultRouter()

urlpatterns = [
    path("", include(router.urls)),
]
