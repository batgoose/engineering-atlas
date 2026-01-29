from rest_framework import viewsets, filters

# We try to import DjangoFilterBackend, but fallback if not installed
try:
    from django_filters.rest_framework import DjangoFilterBackend
except ImportError:
    DjangoFilterBackend = None

from .models import Competency, Artifact, Category
from .serializers import CompetencySerializer, ArtifactSerializer, CategorySerializer


class CategoryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Category.objects.all().order_by("display_order")
    serializer_class = CategorySerializer
    pagination_class = None  # Return all categories in one shot (for menus)


class CompetencyViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for Skills.
    Supported filters: /api/competencies?category=backend
    """

    queryset = (
        Competency.objects.prefetch_related(
            "category",
            "sub_competencies__code_references",  # Deep prefetch for code snippets
            "related_competencies",
        )
        .all()
        .order_by("category__display_order", "name")
    )

    serializer_class = CompetencySerializer

    # Configure Filtering
    filter_backends = [filters.SearchFilter]
    if DjangoFilterBackend:
        filter_backends.append(DjangoFilterBackend)
        filterset_fields = [
            "category",
            "competency_type",
            "proficiency",
            "portfolio_highlight",
        ]

    search_fields = ["name", "summary", "tags"]


class ArtifactViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for Projects.
    Supported filters: /api/artifacts?tech_stack=Python
    """

    # Optimized QuerySet
    queryset = (
        Artifact.objects.prefetch_related(
            "artifactcompetency_set__competency__category"
        )
        .all()
        .order_by("-date_created")
    )

    serializer_class = ArtifactSerializer

    filter_backends = [filters.SearchFilter]
    if DjangoFilterBackend:
        filter_backends.append(DjangoFilterBackend)
        filterset_fields = ["status", "complexity", "demo_type"]

    search_fields = ["title", "description"]

    def get_queryset(self):
        """
        Custom filtering for the ArrayField (tech_stack)
        """
        queryset = super().get_queryset()

        # ArrayField filtering: /api/artifacts?tech_stack=Python
        tech = self.request.query_params.get("tech_stack")
        if tech:
            # Postgres 'contains' operator for arrays
            return queryset.filter(tech_stack__contains=[tech])

        return queryset
