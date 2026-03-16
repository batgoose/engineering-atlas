from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("gridstream", "0031_newsarticle"),
    ]

    operations = [
        migrations.AddField(
            model_name="newsarticle",
            name="author",
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="newsarticle",
            name="body",
            field=models.TextField(blank=True),
        ),
    ]
