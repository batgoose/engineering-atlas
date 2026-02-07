from rest_framework import viewsets, filters

try:
    from django_filters.rest_framework import DjangoFilterBackend
except ImportError:
    DjangoFilterBackend = None

from .models import Competency, Artifact, Category
from .serializers import CompetencySerializer, ArtifactSerializer, CategorySerializer


class CategoryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Category.objects.all().order_by("display_order")
    serializer_class = CategorySerializer
    pagination_class = None


class CompetencyViewSet(viewsets.ReadOnlyModelViewSet):

    queryset = (
        Competency.objects.prefetch_related(
            "category",
            "sub_competencies__code_references",
            "related_competencies",
        )
        .all()
        .order_by("category__display_order", "name")
    )

    serializer_class = CompetencySerializer

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
        filterset_fields = ["status", "domain", "demo_type"]

    search_fields = ["title", "description"]

    def get_queryset(self):
        queryset = super().get_queryset()

        tech = self.request.query_params.get("tech_stack")
        if tech:
            return queryset.filter(tech_stack__contains=[tech])

        return queryset
