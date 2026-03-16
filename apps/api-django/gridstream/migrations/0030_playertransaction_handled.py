from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("gridstream", "0029_playertransaction_unique_constraint"),
    ]

    operations = [
        migrations.AddField(
            model_name="playertransaction",
            name="is_handled",
            field=models.BooleanField(default=False, db_index=True),
        ),
        migrations.AddField(
            model_name="playertransaction",
            name="handled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
