from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):

    dependencies = [
        ("gridstream", "0013_play_blocked_player_fields"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="player",
            index=models.Index(
                fields=["current_team", "draft_year"],
                name="gridstream_pla_scope_idx",
                condition=Q(is_active=True) & ~Q(roster_status__in=["RET", "CUT"]),
            ),
        ),
        migrations.RunSQL(
            sql="""
                CREATE INDEX IF NOT EXISTS raw_nflverse_snap_counts_player_idx
                    ON raw.raw_nflverse_snap_counts (player_id);
                CREATE INDEX IF NOT EXISTS raw_nflverse_depth_charts_player_depth_idx
                    ON raw.raw_nflverse_depth_charts (player_id, depth_rank);
            """,
            reverse_sql="""
                DROP INDEX IF EXISTS raw.raw_nflverse_snap_counts_player_idx;
                DROP INDEX IF EXISTS raw.raw_nflverse_depth_charts_player_depth_idx;
            """,
        ),
    ]
