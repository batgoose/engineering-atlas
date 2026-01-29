from django.db import models
from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.utils.text import slugify


class Category(models.Model):
    """
    High-level groupings (Frontend, Systems, etc.).
    """

    id = models.SlugField(
        max_length=50, primary_key=True, help_text="URL-safe ID (e.g. 'frontend')"
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    display_order = models.IntegerField(
        default=0, help_text="Lower numbers appear first"
    )

    class Meta:
        verbose_name_plural = "Categories"
        ordering = ["display_order", "name"]

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Competency(models.Model):
    PROFICIENCY_CHOICES = [
        ("Learning", "Learning"),
        ("Proficient", "Proficient"),
        ("Advanced", "Advanced"),
        ("Expert", "Expert"),
        ("Veteran", "Veteran"),
        ("Professional", "Professional"),
    ]

    TYPE_CHOICES = [
        ("language", "Language"),
        ("framework", "Framework"),
        ("library", "Library"),
        ("infrastructure", "Infrastructure"),
        ("tooling", "Tooling"),
        ("concept", "Concept"),
        ("methodology", "Methodology"),
    ]

    PRIORITY_CHOICES = [
        ("high", "High"),
        ("medium", "Medium"),
        ("low", "Low"),
        ("hidden", "Hidden"),
    ]

    id = models.SlugField(max_length=100, primary_key=True)
    name = models.CharField(max_length=200)

    category = models.ForeignKey(
        Category, on_delete=models.PROTECT, related_name="competencies"
    )
    competency_type = models.CharField(
        max_length=50, choices=TYPE_CHOICES, default="concept"
    )
    proficiency = models.CharField(max_length=50, choices=PROFICIENCY_CHOICES)
    summary = models.TextField()

    tags = ArrayField(models.CharField(max_length=50), blank=True, default=list)
    related_competencies = models.ManyToManyField("self", blank=True, symmetrical=False)
    history = models.JSONField(default=list, blank=True)
    showcase_priority = models.CharField(
        max_length=20, choices=PRIORITY_CHOICES, default="medium"
    )
    portfolio_highlight = models.BooleanField(default=False)

    class Meta:
        indexes = [
            models.Index(fields=["category", "showcase_priority"]),
            models.Index(fields=["competency_type", "proficiency"]),
            models.Index(fields=["portfolio_highlight"]),
        ]
        ordering = ["category__display_order", "name"]

    def clean(self):
        if self.id and not self.id.strip():
            raise ValidationError({"id": "Generated slug cannot be empty"})

    def save(self, *args, **kwargs):
        if not self.id:
            # Robust slug generation for tech terms
            replacements = {
                "++": "pp",
                "#": "sharp",
                ".": "dot",
                "@": "at",
            }
            clean_name = self.name
            for old, new in replacements.items():
                clean_name = clean_name.replace(old, new)
            self.id = slugify(clean_name)

        # Validation runs AFTER slug is set
        self.full_clean()
        super().save(*args, **kwargs)

    def get_absolute_url(self):
        return f"/competencies/{self.id}/"

    def __str__(self):
        return self.name


class CommitCodeReference(models.Model):
    owner = models.CharField(max_length=100, default="batgoose")
    repository = models.CharField(max_length=100, default="engineering-atlas")
    commit_hash = models.CharField(max_length=40, help_text="Full SHA-1 hash")
    file_path = models.CharField(max_length=255)
    start_line = models.PositiveIntegerField()
    end_line = models.PositiveIntegerField(null=True, blank=True)
    language = models.CharField(max_length=50, blank=True)
    cached_snippet = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.file_path} ({self.start_line}-{self.end_line})"

    @property
    def github_url(self):
        base = f"https://github.com/{self.owner}/{self.repository}/blob/{self.commit_hash}/{self.file_path}"
        if self.start_line:
            line_fragment = f"L{self.start_line}"
            if self.end_line and self.end_line != self.start_line:
                line_fragment += f"-L{self.end_line}"
            return f"{base}#{line_fragment}"
        return base

    @property
    def raw_url(self):
        return f"https://raw.githubusercontent.com/{self.owner}/{self.repository}/{self.commit_hash}/{self.file_path}"

    def clean(self):
        if len(self.commit_hash) != 40:
            raise ValidationError(
                {"commit_hash": "Must be a valid 40-character SHA-1 hash"}
            )
        if self.end_line and self.end_line < self.start_line:
            raise ValidationError({"end_line": "End line must be >= start line"})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class SubCompetency(models.Model):
    id = models.SlugField(max_length=100, primary_key=True)
    parent = models.ForeignKey(
        Competency, related_name="sub_competencies", on_delete=models.CASCADE
    )
    name = models.CharField(max_length=200)
    desc = models.TextField()
    display_order = models.IntegerField(default=0)
    code_references = models.ManyToManyField(CommitCodeReference, blank=True)

    class Meta:
        verbose_name_plural = "Sub Competencies"
        ordering = ["parent", "display_order", "name"]

    def save(self, *args, **kwargs):
        if not self.id:
            if self.parent_id:  # Safer check that avoids DB query
                self.id = slugify(f"{self.parent_id}-{self.name}")
            else:
                # Should not happen if foreign key is enforced, but good for fixtures
                raise ValidationError("SubCompetency must have a parent before saving")
        super().save(*args, **kwargs)


class Artifact(models.Model):
    STATUS_CHOICES = [
        ("planned", "Planned"),
        ("in-progress", "In Progress"),
        ("complete", "Complete"),
    ]

    COMPLEXITY_CHOICES = [
        ("beginner", "Beginner"),
        ("intermediate", "Intermediate"),
        ("advanced", "Advanced"),
    ]

    DEMO_TYPE_CHOICES = [
        ("code-snippet", "Code Snippet"),
        ("interactive", "Interactive Demo"),
        ("live-site", "Live Website"),
        ("video", "Video Walkthrough"),
        ("case-study", "Case Study"),
        ("visual-asset", "Visual Asset (Screenshot)"),
        ("config", "Configuration File"),
        ("schema-def", "Schema Definition"),
    ]

    id = models.SlugField(max_length=100, primary_key=True)
    title = models.CharField(max_length=200)
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default="planned")
    complexity = models.CharField(max_length=50, choices=COMPLEXITY_CHOICES)
    demo_type = models.CharField(max_length=50, choices=DEMO_TYPE_CHOICES)

    description = models.TextField()
    repo_url = models.CharField(max_length=255, blank=True, default="")
    live_url = models.CharField(max_length=255, blank=True, default="")

    date_created = models.DateField(auto_now_add=True)
    last_updated = models.DateField(auto_now=True)

    tech_stack = ArrayField(models.CharField(max_length=50), blank=True, default=list)

    competencies = models.ManyToManyField(
        Competency, through="ArtifactCompetency", related_name="artifacts"
    )

    class Meta:
        indexes = [
            models.Index(fields=["status", "complexity"]),
            models.Index(fields=["demo_type"]),
            models.Index(fields=["-date_created"]),
        ]
        ordering = ["-date_created"]

    def clean(self):
        """
        Enforce business logic, but relax rules for Planned/In-Progress items.
        """
        # SKIP validation if the project isn't finished yet
        if self.status in ["planned", "in-progress"]:
            return

        # STRICT validation for 'complete' items
        if self.demo_type in ["interactive", "live-site"] and not self.live_url:
            raise ValidationError(
                {"live_url": "Interactive/Live demos must have a valid Live URL."}
            )

        if self.demo_type == "code-snippet" and not self.repo_url:
            raise ValidationError(
                {"repo_url": "Code Snippets must have a Repository URL."}
            )

        if self.id and not self.id.strip():
            raise ValidationError({"id": "Generated slug cannot be empty"})

    def save(self, *args, **kwargs):
        # 1. Auto-generate Slug from Title if missing
        if not self.id:
            base_slug = slugify(self.title)
            slug = base_slug
            counter = 1
            # Handle collisions (e.g. two projects named "Portfolio")
            while Artifact.objects.filter(id=slug).exclude(pk=self.pk).exists():
                slug = f"{base_slug}-{counter}"
                counter += 1
            self.id = slug

        # 2. Run Validation (calls clean() above)
        self.full_clean()

        # 3. Save to DB
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title


class ArtifactCompetency(models.Model):
    ROLE_CHOICES = [
        ("primary", "Primary Tech"),
        ("secondary", "Secondary Tech"),
        ("supporting", "Supporting Tech"),
    ]

    artifact = models.ForeignKey(Artifact, on_delete=models.CASCADE)
    competency = models.ForeignKey(Competency, on_delete=models.CASCADE)
    role = models.CharField(max_length=50, choices=ROLE_CHOICES)

    class Meta:
        unique_together = ("artifact", "competency")
