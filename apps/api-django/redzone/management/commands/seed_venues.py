"""
Management command: seed_venues

Extracts unique stadiums from the existing nflverse `plays` table
and populates the Venue model. Also enriches with roof/surface data
from the plays table.

Usage:
    python manage.py seed_venues
"""

from django.core.management.base import BaseCommand
from django.db import connections
from redzone.models import Venue


# Known venue coordinates for weather API lookups
# (major current NFL stadiums — extend as needed)
VENUE_COORDS = {
    "Arrowhead Stadium": (39.0489, -94.4839),
    "Allegiant Stadium": (36.0907, -115.1833),
    "AT&T Stadium": (32.7473, -97.0945),
    "Bank of America Stadium": (35.2258, -80.8528),
    "Caesars Superdome": (29.9511, -90.0812),
    "Empower Field at Mile High": (39.7439, -105.0201),
    "FedExField": (38.9076, -76.8645),
    "Ford Field": (42.34, -83.0456),
    "GEHA Field at Arrowhead Stadium": (39.0489, -94.4839),
    "Gillette Stadium": (42.0909, -71.2643),
    "Hard Rock Stadium": (25.958, -80.2389),
    "Highmark Stadium": (42.7738, -78.787),
    "Huntington Bank Stadium": (44.9765, -93.2245),
    "TIAA Bank Field": (30.3239, -81.6373),
    "EverBank Stadium": (30.3239, -81.6373),
    "Levi's Stadium": (37.4033, -121.9694),
    "Lincoln Financial Field": (39.9008, -75.1675),
    "Los Angeles Memorial Coliseum": (34.0141, -118.2879),
    "Lucas Oil Stadium": (39.7601, -86.1639),
    "Lumen Field": (47.5952, -122.3316),
    "M&T Bank Stadium": (39.2779, -76.6227),
    "Mercedes-Benz Stadium": (33.7554, -84.4005),
    "MetLife Stadium": (40.8135, -74.0745),
    "Nissan Stadium": (36.1665, -86.7713),
    "NRG Stadium": (29.6847, -95.4107),
    "Paycor Stadium": (39.0954, -84.516),
    "Raymond James Stadium": (27.9759, -82.5033),
    "SoFi Stadium": (33.9535, -118.3392),
    "Soldier Field": (41.8623, -87.6167),
    "State Farm Stadium": (33.5276, -112.2626),
    "U.S. Bank Stadium": (44.9736, -93.2575),
    "Acrisure Stadium": (40.4468, -80.0158),
    "Northwest Stadium": (38.9076, -76.8645),
    "Tottenham Hotspur Stadium": (51.6042, -0.0662),
    "Wembley Stadium": (51.556, -0.2795),
    "Estadio Azteca": (19.3029, -99.1505),
    "Allianz Arena": (48.2188, 11.6247),
}


class Command(BaseCommand):
    help = "Seed venues from nflverse plays table stadium/surface/roof data"

    def handle(self, *args, **options):
        self.stdout.write("Querying distinct stadiums from plays table...")

        with connections["nfl"].cursor() as cursor:
            cursor.execute("""
                SELECT DISTINCT
                    stadium,
                    surface,
                    roof
                FROM plays
                WHERE stadium IS NOT NULL AND stadium != ''
                ORDER BY stadium
            """)
            rows = cursor.fetchall()

        self.stdout.write(f"Found {len(rows)} unique stadium entries")

        created = 0
        updated = 0

        for stadium, surface, roof in rows:
            if not stadium:
                continue

            # Determine roof type
            roof_type = "outdoors"
            is_indoor = False
            if roof:
                roof_lower = roof.lower().strip()
                if roof_lower in ("dome", "closed"):
                    roof_type = "dome"
                    is_indoor = True
                elif roof_lower in ("retractable",):
                    roof_type = "retractable"
                elif roof_lower == "outdoors":
                    roof_type = "outdoors"
                elif roof_lower == "open":
                    # retractable roof that's open
                    roof_type = "retractable"

            # Look up coordinates
            coords = VENUE_COORDS.get(stadium, (None, None))

            venue, was_created = Venue.objects.using("nfl").update_or_create(
                name=stadium,
                defaults={
                    "surface": surface or "",
                    "roof_type": roof_type,
                    "is_indoor": is_indoor,
                    "latitude": coords[0],
                    "longitude": coords[1],
                },
            )

            if was_created:
                created += 1
                self.stdout.write(self.style.SUCCESS(
                    f"  Created: {stadium} ({roof_type}, {surface})"
                ))
            else:
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone! Created {created}, updated {updated} venues."
            )
        )
