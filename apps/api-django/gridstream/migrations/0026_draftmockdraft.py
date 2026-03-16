# Generated manually 2026-03-10

from django.db import migrations

CREATE_SQL = """
CREATE TABLE IF NOT EXISTS gridstream_draftmockdraft (
    id BIGSERIAL PRIMARY KEY,
    season INTEGER NOT NULL,
    slug VARCHAR(160) NOT NULL,
    source_key VARCHAR(80) NOT NULL DEFAULT '',
    source_label VARCHAR(160) NOT NULL DEFAULT '',
    source_analyst VARCHAR(80) NOT NULL DEFAULT '',
    source_outlet VARCHAR(80) NOT NULL DEFAULT '',
    source_url VARCHAR(500) NOT NULL DEFAULT '',
    source_updated DATE,
    picks JSONB NOT NULL DEFAULT '[]',
    scraped_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (season, slug)
);
CREATE INDEX IF NOT EXISTS gs_dmd_season_idx ON gridstream_draftmockdraft (season);
CREATE INDEX IF NOT EXISTS gs_dmd_season_source_idx ON gridstream_draftmockdraft (season, source_key);
"""

DROP_SQL = "DROP TABLE IF EXISTS gridstream_draftmockdraft;"


class Migration(migrations.Migration):

    dependencies = [
        ("gridstream", "0025_draftprospectrankings"),
    ]

    operations = [
        migrations.RunSQL(sql=CREATE_SQL, reverse_sql=DROP_SQL),
    ]
