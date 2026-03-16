from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("gridstream", "0027_playerras"),
    ]

    operations = [
        migrations.CreateModel(
            name="SyncJobRun",
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
                ("action_key", models.CharField(db_index=True, max_length=64)),
                (
                    "task_id",
                    models.CharField(blank=True, db_index=True, max_length=255),
                ),
                ("status", models.CharField(default="queued", max_length=20)),
                ("command_preview", models.CharField(blank=True, max_length=1000)),
                ("started_at", models.DateTimeField(auto_now_add=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("output", models.TextField(blank=True)),
            ],
            options={
                "ordering": ["-started_at"],
                "app_label": "gridstream",
            },
        ),
    ]
