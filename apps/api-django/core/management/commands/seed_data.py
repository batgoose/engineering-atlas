import json
import os
from django.core.management.base import BaseCommand
from django.conf import settings
from django.db import transaction
from core.models import Competency, Category, Artifact, ArtifactCompetency

class Command(BaseCommand):
    help = 'Seeds the database with competencies, categories, and artifacts'

    def add_arguments(self, parser):
        parser.add_argument('--clear', action='store_true', help='Wipe data before seeding')

    def find_file(self, filename, search_paths):
        for path in search_paths:
            full_path = os.path.join(path, filename)
            if os.path.exists(full_path):
                return full_path
        return None

    def handle(self, *args, **options):
        # Define paths to look for JSON files
        base_dir = settings.BASE_DIR.parent.parent 
        search_paths = [
            os.path.join(base_dir, 'packages/db/seeds'),
            os.path.join(base_dir, 'packages/db/seeds'),
            base_dir,
        ]

        comp_path = self.find_file('competencies.json', search_paths)
        art_path = self.find_file('artifacts.json', search_paths)

        try:
            with transaction.atomic():
                # 1. Clear Old Data
                if options['clear']:
                    self.stdout.write(self.style.WARNING('Clearing all data...'))
                    ArtifactCompetency.objects.all().delete() # Delete links first
                    Artifact.objects.all().delete()
                    Competency.objects.all().delete()
                    Category.objects.all().delete()

                # 2. Seed Competencies
                if comp_path:
                    self.seed_competencies(comp_path)
                else:
                    self.stdout.write(self.style.ERROR("Missing: competencies.json"))
                
                # 3. Seed Artifacts
                if art_path:
                    self.seed_artifacts(art_path)
                else:
                    self.stdout.write(self.style.WARNING("Missing: artifacts.json"))

        except Exception as e:
            self.stdout.write(self.style.ERROR(f"CRITICAL FAILURE: {e}"))
            raise e

    def seed_competencies(self, path):
        with open(path, 'r') as f:
            data = json.load(f)

        self.stdout.write(f"Processing {len(data)} competencies...")

        # STEP A: Create Categories (Required for Foreign Keys)
        category_names = set(item.get('category') for item in data if item.get('category'))
        category_map = {}
        
        for name in category_names:
            cat_obj, _ = Category.objects.get_or_create(name=name)
            category_map[name] = cat_obj

        # STEP B: Create Competency Objects
        for item in data:
            cat_instance = category_map.get(item.get('category'))
            if not cat_instance: continue # Skip if no category

            Competency.objects.update_or_create(
                id=item['id'],
                defaults={
                    'name': item['name'],
                    'category': cat_instance,
                    'competency_type': item.get('competency_type', 'concept'),
                    'proficiency': item.get('proficiency', 'Learning'),
                    'summary': item.get('summary', ''),
                    
                    # New field you requested
                    'description': item.get('description', ''),
                    
                    # Store Arrays
                    'tags': item.get('tags', []),
                    'history': item.get('history', []),
                    
                    # UI Flags
                    'showcase_priority': item.get('showcasePriority', 'medium'),
                    'portfolio_highlight': item.get('portfolioHighlight', False),
                }
            )

        # STEP C: Link Related Competencies (ManyToMany)
        # We do this AFTER creating all items so we don't link to non-existent IDs
        self.stdout.write("Linking internal competency graph...")
        for item in data:
            if 'related_ids' in item and item['related_ids']:
                try:
                    comp = Competency.objects.get(id=item['id'])
                    valid_ids = Competency.objects.filter(id__in=item['related_ids'])
                    comp.related_competencies.set(valid_ids) 
                except Competency.DoesNotExist:
                    continue
        
        self.stdout.write(self.style.SUCCESS("Competencies seeded."))

    def seed_artifacts(self, path):
        with open(path, 'r') as f:
            data = json.load(f)
        
        self.stdout.write(f"Processing {len(data)} artifacts...")
        
        for item in data:
            # 1. Create the Artifact
            artifact, _ = Artifact.objects.update_or_create(
                id=item['id'],
                defaults={
                    'title': item.get('title', item['id']),
                    'status': item.get('status', 'planned'),
                    'complexity': item.get('complexity', 'intermediate'),
                    'demo_type': item.get('demo_type', 'code-snippet'),
                    'description': item.get('description', ''),
                    'repo_url': item.get('repo_url', ''),
                    'live_url': item.get('live_url', ''),
                    'tech_stack': item.get('tech_stack', []),
                    
                    # Optional: Handle date if your model expects it, otherwise Django defaults to now
                    # 'date_created': item.get('date_created', '2025-01-01') 
                }
            )

            # 2. Link Competencies to Artifact (The "Through" Model)
            # This populates the grid showing which tools were used in this project
            if 'competencies' in item:
                for comp_ref in item['competencies']:
                    comp_id = comp_ref.get('id')
                    role = comp_ref.get('role', 'supporting')

                    # Only link if competency exists
                    try:
                        comp_obj = Competency.objects.get(id=comp_id)
                        ArtifactCompetency.objects.update_or_create(
                            artifact=artifact,
                            competency=comp_obj,
                            defaults={'role': role}
                        )
                    except Competency.DoesNotExist:
                        self.stdout.write(self.style.WARNING(f"Artifact {item['id']} references missing competency: {comp_id}"))

        self.stdout.write(self.style.SUCCESS("Artifacts seeded and linked."))