from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("gridstream", "0012_play_total_epa_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="play",
            name="blocked_player_id",
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.AddField(
            model_name="play",
            name="blocked_player_name",
            field=models.CharField(blank=True, max_length=60),
        ),
    ]
