from rest_framework import serializers
from .models import (
    Category,
    Competency,
    SubCompetency,
    Artifact,
    ArtifactCompetency,
    CommitCodeReference,
)


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        # Frontend will handle the visual mapping (Icon/Color) based on 'name'
        fields = ["id", "name", "description", "display_order"]


class CommitCodeReferenceSerializer(serializers.ModelSerializer):
    github_url = serializers.ReadOnlyField()
    raw_url = serializers.ReadOnlyField()

    class Meta:
        model = CommitCodeReference
        fields = [
            "id",
            "repository",
            "file_path",
            "start_line",
            "end_line",
            "language",
            "github_url",
            "raw_url",
            "cached_snippet",
        ]


class SubCompetencySerializer(serializers.ModelSerializer):
    # Nesting code references directly so the frontend gets them in one fetch
    code_references = CommitCodeReferenceSerializer(many=True, read_only=True)

    class Meta:
        model = SubCompetency
        fields = ["id", "name", "desc", "display_order", "code_references"]


class CompetencyLinkSerializer(serializers.ModelSerializer):
    """
    Tiny serializer for graph links.
    Prevents recursion/bloat when fetching related skills.
    """

    class Meta:
        model = Competency
        fields = ["id", "name", "competency_type"]


class CompetencySerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    sub_competencies = SubCompetencySerializer(many=True, read_only=True)

    # Returns ID + Name so the frontend can build clickable <a> tags
    related_competencies = CompetencyLinkSerializer(many=True, read_only=True)

    class Meta:
        model = Competency
        fields = [
            "id",
            "name",
            "category",
            "competency_type",
            "proficiency",
            "summary",
            "tags",
            "sub_competencies",
            "related_competencies",
            "showcase_priority",
            "portfolio_highlight",
            "history",
        ]


class ArtifactCompetencySerializer(serializers.ModelSerializer):
    """
    Flattened serializer for Project Cards.
    """

    id = serializers.ReadOnlyField(source="competency.id")
    name = serializers.ReadOnlyField(source="competency.name")
    category_name = serializers.ReadOnlyField(source="competency.category.name")

    class Meta:
        model = ArtifactCompetency
        fields = ["id", "name", "category_name", "role"]


class ArtifactSerializer(serializers.ModelSerializer):
    # 'source' matches the custom Prefetch in views.py
    competencies = ArtifactCompetencySerializer(
        source="artifactcompetency_set", many=True, read_only=True
    )

    class Meta:
        model = Artifact
        fields = [
            "id",
            "title",
            "status",
            "complexity",
            "demo_type",
            "description",
            "tech_stack",
            "repo_url",
            "live_url",
            "date_created",
            "competencies",
        ]
