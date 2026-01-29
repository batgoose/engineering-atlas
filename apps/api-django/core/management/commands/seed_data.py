import json
import os
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils.text import slugify
# CORRECTED IMPORT: The app is named 'core'
from core.models import Category, Competency, SubCompetency, Artifact, ArtifactCompetency

class Command(BaseCommand):
    help = 'Seeds the database from local JSON files in packages/db/seeds'

    def add_arguments(self, parser):
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Clear existing data before seeding',
        )

    def handle(self, *args, **options):
        # Optionally clear existing data
        if options['clear']:
            self.stdout.write(self.style.WARNING("Clearing existing data..."))
            # Order matters due to ForeignKeys (delete children first)
            ArtifactCompetency.objects.all().delete()
            Artifact.objects.all().delete()
            SubCompetency.objects.all().delete()
            Competency.objects.all().delete()
            Category.objects.all().delete()

        # 1. Locate the JSON files
        # Logic: apps/api-django/../../packages/db/seeds -> <root>/packages/db/seeds
        # settings.BASE_DIR is usually a Path object in modern Django
        base_path = settings.BASE_DIR.parent.parent / "packages" / "db" / "seeds"
        
        if not base_path.exists():
            self.stdout.write(self.style.ERROR(f"Seeds folder not found at: {base_path}"))
            return

        self.stdout.write(f"Loading seeds from: {base_path}")

        # 2. Define Standard Categories (Metadata Layer)
        CATEGORY_META = {
            'Frontend': {'display_order': 1, 'desc': 'UI/UX, Mobile, and Client Side'},
            'Backend': {'display_order': 2, 'desc': 'Server, API, and Database Architecture'},
            'Systems': {'display_order': 3, 'desc': 'Low-level, Graphics, and Embedded'},
            'Cloud and DevOps': {'display_order': 4, 'desc': 'CI/CD, Cloud, and Infrastructure'},
            'Data and AI': {'display_order': 5, 'desc': 'AI, RAG, and Analytics'},
            'Security': {'display_order': 6, 'desc': 'AppSec, Auth, and Cryptography'},
            'Business': {'display_order': 7, 'desc': 'Leadership and Strategy'},
            'Core': {'display_order': 8, 'desc': 'Computer Science Fundamentals'},
        }

        # --- PHASE 1: COMPETENCIES ---
        try:
            with open(base_path / "competencies.json", "r") as f:
                comp_data = json.load(f)
        except FileNotFoundError:
            self.stdout.write(self.style.ERROR("competencies.json not found."))
            return

        self.stdout.write("Seeding Competencies...")
        
        competencies_created = 0
        competencies_updated = 0

        for item in comp_data:
            # Handle categories dynamically based on the JSON string
            cat_name = item.get('category', 'Core')
            cat_id = slugify(cat_name) 
            
            # Create Category if it doesn't exist
            cat_obj, _ = Category.objects.get_or_create(
                id=cat_id,
                defaults={
                    'name': cat_name, 
                    'description': CATEGORY_META.get(cat_name, {}).get('desc', ''),
                    'display_order': CATEGORY_META.get(cat_name, {}).get('display_order', 99),
                }
            )

            # Create/Update Competency
            comp_obj, created = Competency.objects.update_or_create(
                id=item['id'],
                defaults={
                    'name': item['name'],
                    'category': cat_obj,
                    'competency_type': item.get('competency_type', 'concept'), # Default to snake_case if in JSON, or fallback
                    'proficiency': item.get('proficiency', 'Proficient'),
                    'summary': item.get('summary', ''),
                    'tags': item.get('tags', []),
                    'history': item.get('history', []),
                    'showcase_priority': item.get('showcasePriority', 'medium'),
                    'portfolio_highlight': item.get('portfolioHighlight', False),
                }
            )
            
            if created:
                competencies_created += 1
            else:
                competencies_updated += 1

            # Handle SubCompetencies
            if 'sub_competencies' in item:
                # delete existing subs to handle re-ordering or removals cleanly
                comp_obj.sub_competencies.all().delete()
                
                for i, sub in enumerate(item['sub_competencies']):
                    SubCompetency.objects.create(
                        id=slugify(f"{comp_obj.id}-{sub['name']}"),
                        parent=comp_obj,
                        name=sub['name'],
                        desc=sub['desc'],
                        display_order=i
                    )
        
        self.stdout.write(self.style.SUCCESS(
            f"  Created {competencies_created}, Updated {competencies_updated} competencies"
        ))

        # Phase 1.5: Link Related Competencies (Self-Referential M2M)
        self.stdout.write("Linking Related Competencies...")
        relations_created = 0
        
        for item in comp_data:
            if 'related_ids' in item and item['related_ids']:
                try:
                    source = Competency.objects.get(id=item['id'])
                    # Clear existing to prevent stale links
                    source.related_competencies.clear()
                    
                    for related_id in item['related_ids']:
                        try:
                            target = Competency.objects.get(id=related_id)
                            source.related_competencies.add(target)
                            relations_created += 1
                        except Competency.DoesNotExist:
                            pass # Fail silently for weak links
                except Competency.DoesNotExist:
                    pass
        
        self.stdout.write(self.style.SUCCESS(f"  Linked {relations_created} relations"))

        # --- PHASE 2: ARTIFACTS ---
        try:
            with open(base_path / "artifacts.json", "r") as f:
                art_data = json.load(f)
        except FileNotFoundError:
            self.stdout.write(self.style.WARNING("artifacts.json not found."))
            art_data = []

        if art_data:
            self.stdout.write("Seeding Artifacts...")
            artifacts_created = 0
            
            for item in art_data:
                # SANITIZATION 1: Map legacy JSON values to valid Model choices
                raw_demo_type = item.get('demoType', 'code-snippet')
                if raw_demo_type == 'code-only':
                    valid_demo_type = 'code-snippet'
                else:
                    valid_demo_type = raw_demo_type

                art_obj, created = Artifact.objects.update_or_create(
                    id=item['id'],
                    defaults={
                        'title': item['title'],
                        'status': item.get('status', 'planned'),
                        'complexity': item.get('complexity', 'intermediate'),
                        'description': item.get('description', ''),
                        'tech_stack': item.get('tech_stack', []),
                        'demo_type': valid_demo_type,
                        
                        # SANITIZATION 2: Coerce None -> "" (Empty String)
                        # 'item.get()' returns None if JSON has null. 'None or ""' becomes "".
                        'repo_url': item.get('repoUrl') or '',
                        'live_url': item.get('liveUrl') or '',
                    }
                )
                
                if created:
                    artifacts_created += 1

                # Link Artifact -> Competencies
                # Use 'competencies' key per artifacts.json
                if 'competencies' in item:
                    # Clear existing relations to keep DB in sync with JSON
                    ArtifactCompetency.objects.filter(artifact=art_obj).delete()
                    
                    for comp_data_item in item['competencies']:
                        if isinstance(comp_data_item, dict):
                            comp_id = comp_data_item.get('id')
                            role = comp_data_item.get('role', 'primary')
                        else:
                            continue 
                        
                        try:
                            comp_obj = Competency.objects.get(id=comp_id)
                            ArtifactCompetency.objects.create(
                                artifact=art_obj,
                                competency=comp_obj,
                                role=role
                            )
                        except Competency.DoesNotExist:
                            self.stdout.write(self.style.WARNING(
                                f"  Artifact {art_obj.id}: Competency {comp_id} not found"
                            ))

            self.stdout.write(self.style.SUCCESS(
                f"  Processed {artifacts_created} artifacts"
            ))

        self.stdout.write(self.style.SUCCESS("\n✓ Database seeded successfully!"))