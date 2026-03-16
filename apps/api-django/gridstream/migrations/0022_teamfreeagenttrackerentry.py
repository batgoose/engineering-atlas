from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("gridstream", "0021_player_depth_chart_rank_player_depth_chart_status"),
    ]

    operations = [
        migrations.CreateModel(
            name="TeamFreeAgentTrackerEntry",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "season",
                    models.IntegerField(
                        help_text="Calendar year of the free-agent tracker page (e.g. 2026)"
                    ),
                ),
                ("player_name", models.CharField(max_length=100)),
                ("ourlads_player_id", models.CharField(blank=True, max_length=20)),
                ("position", models.CharField(blank=True, max_length=10)),
                (
                    "fa_type",
                    models.CharField(
                        blank=True,
                        help_text="UFA, RFA, ERFA, CC, etc.",
                        max_length=10,
                    ),
                ),
                (
                    "tracker_status",
                    models.CharField(
                        choices=[
                            ("unsigned", "Unsigned"),
                            ("re_signed", "Re-signed With Team"),
                            ("signed_elsewhere", "Signed Elsewhere"),
                        ],
                        default="unsigned",
                        max_length=20,
                    ),
                ),
                ("source_url", models.URLField(blank=True, max_length=500)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "player",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="free_agent_tracker_entries",
                        to="gridstream.player",
                    ),
                ),
                (
                    "signed_with_team",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="signed_free_agent_tracker_entries",
                        to="gridstream.team",
                    ),
                ),
                (
                    "team",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="free_agent_tracker_entries",
                        to="gridstream.team",
                    ),
                ),
            ],
            options={
                "ordering": ["team__abbreviation", "season", "player_name"],
            },
        ),
        migrations.AddIndex(
            model_name="teamfreeagenttrackerentry",
            index=models.Index(
                fields=["team", "season"], name="gridstream__team_id_9295e5_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="teamfreeagenttrackerentry",
            index=models.Index(
                fields=["signed_with_team", "season"],
                name="gridstream__signed__cb1fcf_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="teamfreeagenttrackerentry",
            index=models.Index(
                fields=["player", "season"], name="gridstream__player__d77e64_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="teamfreeagenttrackerentry",
            index=models.Index(
                fields=["season", "fa_type"], name="gridstream__season__17a24d_idx"
            ),
        ),
    ]
