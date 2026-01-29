from django.contrib import admin
from django.db.models import Prefetch
from .models import (
    Category,
    Competency,
    SubCompetency,
    Artifact,
    ArtifactCompetency,
    CommitCodeReference,
)


class TechStackFilter(admin.SimpleListFilter):
    """Custom filter for ArrayField tech_stack"""

    title = "Tech Stack"
    parameter_name = "tech_stack"

    def lookups(self, request, model_admin):
        # Optimized: Get distinct values faster
        artifacts = model_admin.model.objects.values_list("tech_stack", flat=True)
        unique_tags = set()
        for stack in artifacts:
            if stack:  # Guard against None/Empty
                unique_tags.update(stack)
        return sorted([(tag, tag) for tag in unique_tags])

    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(tech_stack__contains=[self.value()])
        return queryset


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "id", "display_order")
    search_fields = ("name",)
    ordering = ("display_order", "name")


class SubCompetencyInline(admin.TabularInline):
    model = SubCompetency
    extra = 1
    fields = ("name", "desc", "display_order")
    ordering = ("display_order",)


@admin.register(Competency)
class CompetencyAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "category",
        "competency_type",
        "proficiency",
        "showcase_priority",
        "portfolio_highlight",
    )
    list_filter = (
        "category",
        "competency_type",
        "proficiency",
        "showcase_priority",
        "portfolio_highlight",
    )
    search_fields = ("name", "summary")
    filter_horizontal = ("related_competencies",)
    inlines = [SubCompetencyInline]

    fieldsets = (
        (
            "Basic Info",
            {
                "fields": (
                    "id",
                    "name",
                    "category",
                    "competency_type",
                    "proficiency",
                    "summary",
                )
            },
        ),
        ("Metadata", {"fields": ("tags", "related_competencies", "history")}),
        ("Display", {"fields": ("showcase_priority", "portfolio_highlight")}),
    )


@admin.register(SubCompetency)
class SubCompetencyAdmin(admin.ModelAdmin):
    list_display = ("name", "parent", "display_order")
    list_filter = ("parent",)
    search_fields = ("name", "desc")
    filter_horizontal = ("code_references",)
    ordering = ("parent", "display_order")


@admin.register(CommitCodeReference)
class CommitCodeReferenceAdmin(admin.ModelAdmin):
    list_display = (
        "file_path",
        "commit_hash_short",
        "language",
        "line_range",
        "created_at",
    )
    list_filter = ("language", "repository")
    search_fields = ("file_path", "commit_hash", "cached_snippet")
    readonly_fields = ("created_at", "updated_at", "github_url", "raw_url")

    fieldsets = (
        (
            "Repository Info",
            {"fields": ("owner", "repository", "commit_hash", "file_path")},
        ),
        ("Code Location", {"fields": ("start_line", "end_line", "language")}),
        ("Cache", {"fields": ("cached_snippet",), "classes": ("collapse",)}),
        (
            "URLs",
            {
                "fields": ("github_url", "raw_url"),
            },
        ),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )

    def commit_hash_short(self, obj):
        return obj.commit_hash[:7]

    commit_hash_short.short_description = "Commit"

    def line_range(self, obj):
        if obj.end_line and obj.end_line != obj.start_line:
            return f"L{obj.start_line}-{obj.end_line}"
        return f"L{obj.start_line}"

    line_range.short_description = "Lines"


class ArtifactCompetencyInline(admin.TabularInline):
    model = ArtifactCompetency
    extra = 1
    autocomplete_fields = ("competency",)


@admin.register(Artifact)
class ArtifactAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "status",
        "complexity",
        "demo_type",
        "primary_competencies_list",
        "date_created",
    )
    list_filter = ("status", "complexity", "demo_type", TechStackFilter, "date_created")
    search_fields = ("title", "description")
    date_hierarchy = "date_created"
    readonly_fields = ("date_created", "last_updated")
    inlines = [ArtifactCompetencyInline]

    fieldsets = (
        (
            "Basic Info",
            {
                "fields": (
                    "id",
                    "title",
                    "description",
                    "status",
                    "complexity",
                    "demo_type",
                )
            },
        ),
        ("Links", {"fields": ("repo_url", "live_url")}),
        ("Metadata", {"fields": ("tech_stack",)}),
        (
            "Timestamps",
            {"fields": ("date_created", "last_updated"), "classes": ("collapse",)},
        ),
    )

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        # Add a hint directly to the UI input
        field = form.base_fields["tech_stack"]
        field.help_text = (
            "Enter technologies separated by commas (e.g. 'Python, React, AWS')"
        )
        field.widget.attrs["placeholder"] = "Python, React, AWS"
        field.widget.attrs["style"] = "width: 400px;"  # Make it wider for easier typing
        return form

    # Prefetch related data to solve N+1 query problem
    def get_queryset(self, request):
        qs = super().get_queryset(request)
        # Prefetch with select_related to get the competency data in one go
        return qs.prefetch_related(
            Prefetch(
                "artifactcompetency_set",
                queryset=ArtifactCompetency.objects.select_related("competency"),
            )
        )

    def primary_competencies_list(self, obj):
        # Use Python list filtering (in memory) instead of DB queries
        # because I already prefetched 'artifactcompetency_set'
        primaries = [
            ac.competency.name
            for ac in obj.artifactcompetency_set.all()
            if ac.role == "primary"
        ]

        if not primaries:
            return "—"
        return ", ".join(primaries[:3])

    primary_competencies_list.short_description = "Primary Tech"
