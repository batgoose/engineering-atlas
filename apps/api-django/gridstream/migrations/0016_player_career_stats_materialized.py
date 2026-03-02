from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("gridstream", "0015_player_award"),
    ]

    operations = [
        migrations.AddField(model_name="player", name="mat_games_played", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_seasons_count", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_first_season", field=models.IntegerField(null=True, blank=True)),
        migrations.AddField(model_name="player", name="mat_last_season", field=models.IntegerField(null=True, blank=True)),
        migrations.AddField(model_name="player", name="mat_completions", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_pass_attempts", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_passing_yards", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_passing_tds", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_interceptions_thrown", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_sacks_taken", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_carries", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_rushing_yards", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_rushing_tds", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_rushing_long", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_receptions", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_targets", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_receiving_yards", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_receiving_tds", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_receiving_long", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_pass_first_downs", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_rush_first_downs", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_rec_first_downs", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_fumbles_rushing", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_fumbles_receiving", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_fumbles_sacks", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_fumbles_lost_rushing", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_fumbles_lost_receiving", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_fumbles_lost_sacks", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_tackles_total", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_sacks_made", field=models.FloatField(default=0.0)),
        migrations.AddField(model_name="player", name="mat_interceptions_caught", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_passes_defended", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_forced_fumbles", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_fg_made", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_fg_attempts", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="player", name="mat_punt_attempts", field=models.IntegerField(default=0)),
    ]
