from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import CategoryViewSet, CompetencyViewSet, ArtifactViewSet

router = DefaultRouter()
router.register(r"categories", CategoryViewSet)
router.register(r"competencies", CompetencyViewSet)
router.register(r"artifacts", ArtifactViewSet)

urlpatterns = [
    path("", include(router.urls)),
]
