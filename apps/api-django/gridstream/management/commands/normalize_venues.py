"""
Normalize venue roof metadata and indoor flags.

This command reconciles Venue.roof_type / Venue.is_indoor using centralized
mapping logic and merges duplicate venues by exact name.
"""

from collections import defaultdict

from django.core.management.base import BaseCommand

from gridstream.models import Venue
from gridstream.venue_metadata import infer_is_indoor, infer_roof_type


class Command(BaseCommand):
    help = "Normalize venue roof_type/is_indoor fields and merge exact-name duplicates."

    def handle(self, *args, **options):
        venues = list(Venue.objects.using("nfl").all().order_by("id"))
        if not venues:
            self.stdout.write("No venues to normalize.")
            return

        merged = 0
        updated = 0
        name_groups = defaultdict(list)
        for venue in venues:
            key = (venue.name or "").strip()
            if key:
                name_groups[key].append(venue)

        for group in name_groups.values():
            if len(group) <= 1:
                continue
            canonical = self._pick_canonical(group)
            for duplicate in group:
                if duplicate.id == canonical.id:
                    continue
                if not canonical.espn_id and duplicate.espn_id:
                    canonical.espn_id = duplicate.espn_id
                if not canonical.city and duplicate.city:
                    canonical.city = duplicate.city
                if not canonical.state and duplicate.state:
                    canonical.state = duplicate.state
                if not canonical.latitude and duplicate.latitude:
                    canonical.latitude = duplicate.latitude
                if not canonical.longitude and duplicate.longitude:
                    canonical.longitude = duplicate.longitude
                if not canonical.surface and duplicate.surface:
                    canonical.surface = duplicate.surface
                duplicate.games.using("nfl").update(venue=canonical)
                duplicate.delete(using="nfl")
                merged += 1
            canonical.save(using="nfl")

        for venue in Venue.objects.using("nfl").all().order_by("id"):
            resolved_roof = infer_roof_type(
                venue_name=venue.name,
                current_roof=venue.roof_type,
                espn_indoor=venue.is_indoor,
            )
            resolved_indoor = infer_is_indoor(resolved_roof)

            changes = []
            if venue.roof_type != resolved_roof:
                venue.roof_type = resolved_roof
                changes.append("roof_type")
            if venue.is_indoor != resolved_indoor:
                venue.is_indoor = resolved_indoor
                changes.append("is_indoor")
            if changes:
                venue.save(using="nfl", update_fields=changes)
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Done! {updated} venues normalized, {merged} duplicates merged."
            )
        )

    def _pick_canonical(self, venues):
        # Prefer rows with ESPN ID and richer location metadata, then oldest row.
        def _score(v):
            return (
                1 if v.espn_id else 0,
                1 if v.city else 0,
                1 if v.state else 0,
                1 if v.latitude is not None and v.longitude is not None else 0,
                -v.id,
            )

        return sorted(venues, key=_score, reverse=True)[0]
