from django.db import migrations, models


def deduplicate_player_transactions(apps, schema_editor):
    """Remove duplicate PlayerTransaction rows, keeping the lowest id."""
    db = schema_editor.connection.alias
    schema_editor.connection.cursor().execute("""
        DELETE FROM gridstream_playertransaction
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM gridstream_playertransaction
            GROUP BY player_id, transaction_type, date
        )
        """)


class Migration(migrations.Migration):

    atomic = (
        False  # DELETE + ALTER TABLE can't share a transaction (deferred FK triggers)
    )

    dependencies = [
        ("gridstream", "0028_syncjobrun"),
    ]

    operations = [
        migrations.RunPython(
            deduplicate_player_transactions,
            migrations.RunPython.noop,
        ),
        migrations.AddConstraint(
            model_name="playertransaction",
            constraint=models.UniqueConstraint(
                fields=["player", "transaction_type", "date"],
                name="unique_player_transaction_type_date",
            ),
        ),
    ]
