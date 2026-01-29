import json
import os
from django.core.management.base import BaseCommand
from django.conf import settings
from core.models import (
    Category,
    Competency,
    SubCompetency,
    Artifact,
    ArtifactCompetency,
)


class Command(BaseCommand):
    help = "Seeds the database with competencies and artifacts from JSON files"

    def handle(self, *args, **options):
        # Define paths
        seeds_dir = os.path.join(settings.BASE_DIR, "../../packages/db/seeds")

        self.stdout.write(self.style.SUCCESS(f"Loading seeds from: {seeds_dir}"))

        # 1. Seed Competencies
        self.seed_competencies(os.path.join(seeds_dir, "competencies.json"))

        # 2. Seed Artifacts
        self.seed_artifacts(os.path.join(seeds_dir, "artifacts.json"))

    def seed_competencies(self, file_path):
        self.stdout.write("Seeding Competencies...")
        with open(file_path, "r") as f:
            data = json.load(f)

        created_count = 0
        updated_count = 0

        # Pass 1: Create Categories and Core Competencies
        for item in data:
            # 1. Ensure Category exists
            category, _ = Category.objects.get_or_create(name=item["category"])

            # 2. Create/Update Competency
            defaults = {
                "name": item["name"],
                "category": category,
                "competency_type": item.get(
                    "competency_type", "concept"
                ),  # Defaults to concept
                "proficiency": item["proficiency"],
                "summary": item.get("summary", ""),
                "tags": item.get("tags", []),
                "showcase_priority": item.get(
                    "showcasePriority", "medium"
                ),  # Handles camelCase if present
                "portfolio_highlight": item.get("portfolioHighlight", False),
            }

            comp_obj, created = Competency.objects.update_or_create(
                id=item["id"], defaults=defaults
            )

            # 3. Handle Sub-Competencies
            if "sub_competencies" in item:
                for sub in item["sub_competencies"]:
                    SubCompetency.objects.update_or_create(
                        id=sub["id"],
                        defaults={
                            "parent": comp_obj,
                            "name": sub["name"],
                            "desc": sub["desc"],
                            "display_order": sub.get("display_order", 0),
                        },
                    )

            if created:
                created_count += 1
            else:
                updated_count += 1

        # Pass 2: Link Related Competencies (Must happen after all IDs exist)
        self.stdout.write("Linking Related Competencies...")
        links_count = 0
        for item in data:
            if "related_ids" in item:
                current_comp = Competency.objects.get(id=item["id"])
                for rel_id in item["related_ids"]:
                    try:
                        target = Competency.objects.get(id=rel_id)
                        current_comp.related_competencies.add(target)
                        links_count += 1
                    except Competency.DoesNotExist:
                        self.stdout.write(
                            self.style.WARNING(
                                f"Warning: Related ID '{rel_id}' not found for '{item['id']}'"
                            )
                        )

        self.stdout.write(
            self.style.SUCCESS(
                f"  Created {created_count}, Updated {updated_count} competencies"
            )
        )
        self.stdout.write(self.style.SUCCESS(f"  Linked {links_count} relations"))

    def seed_artifacts(self, file_path):
        self.stdout.write("Seeding Artifacts...")
        with open(file_path, "r") as f:
            data = json.load(f)

        for item in data:
            # Prepare defaults using Snake Case (matching the JSON I gave you)
            # We use .get() to be safe, but the keys should match models.py fields
            defaults = {
                "title": item["title"],
                "status": item["status"],
                "complexity": item["complexity"],
                "demo_type": item.get("demo_type", "code-snippet"),
                "description": item["description"],
                "tech_stack": item.get("tech_stack", []),
                "repo_url": item.get(
                    "repo_url", ""
                ),  # Critical: Matches snake_case JSON
                "live_url": item.get("live_url", ""),
                # Handle dates if present, else ignore (auto_now_add handles creation)
            }

            # Create the Artifact
            art_obj, created = Artifact.objects.update_or_create(
                id=item["id"], defaults=defaults
            )

            # Link Competencies
            if "competencies" in item:
                # Clear existing to prevent duplicates/stale links
                ArtifactCompetency.objects.filter(artifact=art_obj).delete()

                for comp_data in item["competencies"]:
                    try:
                        comp_obj = Competency.objects.get(id=comp_data["id"])
                        ArtifactCompetency.objects.create(
                            artifact=art_obj,
                            competency=comp_obj,
                            role=comp_data["role"],
                        )
                    except Competency.DoesNotExist:
                        self.stdout.write(
                            self.style.WARNING(
                                f"  Skill '{comp_data['id']}' not found for artifact '{item['id']}'"
                            )
                        )

        self.stdout.write(self.style.SUCCESS(f"  Processed {len(data)} artifacts"))
