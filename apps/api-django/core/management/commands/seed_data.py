import json
import os
from django.core.management.base import BaseCommand
from django.conf import settings
from django.db import transaction
from core.models import Competency, Category, Artifact, ArtifactCompetency


class Command(BaseCommand):
    help = "Seeds the database with competencies, categories, and artifacts"

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear", action="store_true", help="Wipe data before seeding"
        )

    def find_file(self, filename, search_paths):
        for path in search_paths:
            full_path = os.path.join(path, filename)
            if os.path.exists(full_path):
                return full_path
        return None

    def handle(self, *args, **options):
        search_paths = [
            "/app/seeds",
            os.path.join(settings.BASE_DIR.parent.parent, "packages/db/seeds"),
        ]

        comp_path = self.find_file("competencies.json", search_paths)
        art_path = self.find_file("artifacts.json", search_paths)

        try:
            with transaction.atomic():
                if options["clear"]:
                    self.stdout.write(self.style.WARNING("Clearing all data..."))
                    ArtifactCompetency.objects.all().delete()
                    Artifact.objects.all().delete()
                    Competency.objects.all().delete()
                    Category.objects.all().delete()

                if comp_path:
                    self.seed_competencies(comp_path)
                else:
                    self.stdout.write(self.style.ERROR("Missing: competencies.json"))

                if art_path:
                    self.seed_artifacts(art_path)
                else:
                    self.stdout.write(self.style.WARNING("Missing: artifacts.json"))

        except Exception as e:
            self.stdout.write(self.style.ERROR(f"CRITICAL FAILURE: {e}"))
            raise e

    def seed_competencies(self, path):
        with open(path, "r") as f:
            data = json.load(f)

        self.stdout.write(f"Processing {len(data)} competencies...")

        category_names = set(
            item.get("category") for item in data if item.get("category")
        )
        category_map = {}
        for name in category_names:
            cat_obj, _ = Category.objects.get_or_create(name=name)
            category_map[name] = cat_obj

        for item in data:
            cat_instance = category_map.get(item.get("category"))
            if not cat_instance:
                continue

            Competency.objects.update_or_create(
                id=item["id"],
                defaults={
                    "name": item["name"],
                    "category": cat_instance,
                    "competency_type": item.get("competency_type", "concept"),
                    "proficiency": item.get("proficiency", "Learning"),
                    "summary": item.get("summary", ""),
                    "description": item.get("description", ""),
                    "tags": item.get("tags", []),
                    "history": item.get("history", []),
                    "showcase_priority": item.get("showcasePriority", "medium"),
                    "portfolio_highlight": item.get("portfolioHighlight", False),
                },
            )

        for item in data:
            if "related_ids" in item and item["related_ids"]:
                try:
                    comp = Competency.objects.get(id=item["id"])
                    valid_ids = Competency.objects.filter(id__in=item["related_ids"])
                    comp.related_competencies.set(valid_ids)
                except Competency.DoesNotExist:
                    continue

        self.stdout.write(self.style.SUCCESS("Competencies seeded."))

    def seed_artifacts(self, path):
        with open(path, "r") as f:
            data = json.load(f)

        self.stdout.write(f"Processing {len(data)} artifacts...")

        for item in data:
            artifact, _ = Artifact.objects.update_or_create(
                id=item["id"],
                defaults={
                    "title": item.get("title", item["id"]),
                    "status": item.get("status", "planned"),
                    "domain": item.get("domain", "atlas"),
                    "demo_type": item.get("demo_type", "code-snippet"),
                    "description": item.get("description", ""),
                    "repo_url": item.get("repo_url", ""),
                    "live_url": item.get("live_url", ""),
                    "tech_stack": item.get("tech_stack", []),
                },
            )

            if "competencies" in item:
                for comp_ref in item["competencies"]:
                    comp_id = comp_ref.get("id")
                    role = comp_ref.get("role", "supporting")

                    try:
                        comp_obj = Competency.objects.get(id=comp_id)
                        ArtifactCompetency.objects.update_or_create(
                            artifact=artifact,
                            competency=comp_obj,
                            defaults={"role": role},
                        )
                    except Competency.DoesNotExist:
                        self.stdout.write(
                            self.style.WARNING(
                                f"Artifact {item['id']} references missing competency: {comp_id}"
                            )
                        )

        self.stdout.write(self.style.SUCCESS("Artifacts seeded and linked."))
