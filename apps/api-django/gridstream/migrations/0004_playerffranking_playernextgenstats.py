# Generated migration for PlayerFFRanking and PlayerNextGenStats models.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("gridstream", "0003_rename_redzone_tables_to_gridstream"),
    ]

    operations = [
        migrations.CreateModel(
            name="PlayerFFRanking",
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
                ("season", models.IntegerField()),
                ("week", models.IntegerField()),
                ("position", models.CharField(max_length=5)),
                ("rank", models.FloatField()),
                ("rank_sd", models.FloatField(blank=True, null=True)),
                ("rank_best", models.IntegerField(blank=True, null=True)),
                ("rank_worst", models.IntegerField(blank=True, null=True)),
                ("position_rank", models.IntegerField(blank=True, null=True)),
                (
                    "player",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ff_rankings",
                        to="gridstream.player",
                    ),
                ),
            ],
            options={
                "ordering": ["-season", "-week", "rank"],
                "app_label": "gridstream",
            },
        ),
        migrations.AddIndex(
            model_name="playerffranking",
            index=models.Index(
                fields=["season", "week", "position"],
                name="gridstream_playerffranking_season_week_pos_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="playerffranking",
            index=models.Index(
                fields=["player", "season"],
                name="gridstream_playerffranking_player_season_idx",
            ),
        ),
        migrations.AlterUniqueTogether(
            name="playerffranking",
            unique_together={("player", "season", "week")},
        ),
        migrations.CreateModel(
            name="PlayerNextGenStats",
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
                ("season", models.IntegerField()),
                ("week", models.IntegerField(default=0)),
                ("season_type", models.CharField(default="REG", max_length=4)),
                (
                    "stat_type",
                    models.CharField(
                        choices=[
                            ("passing", "Passing"),
                            ("rushing", "Rushing"),
                            ("receiving", "Receiving"),
                        ],
                        max_length=10,
                    ),
                ),
                ("metrics", models.JSONField(default=dict)),
                (
                    "player",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="nextgen_stats",
                        to="gridstream.player",
                    ),
                ),
            ],
            options={
                "ordering": ["-season", "-week"],
                "app_label": "gridstream",
            },
        ),
        migrations.AddIndex(
            model_name="playernextgenstats",
            index=models.Index(
                fields=["player", "season", "stat_type"],
                name="gridstream_playerngs_player_season_type_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="playernextgenstats",
            index=models.Index(
                fields=["season", "week", "stat_type"],
                name="gridstream_playerngs_season_week_type_idx",
            ),
        ),
        migrations.AlterUniqueTogether(
            name="playernextgenstats",
            unique_together={("player", "season", "week", "stat_type")},
        ),
    ]
