# Generated manually 2026-03-10

from django.db import migrations

CREATE_SQL = """
CREATE TABLE IF NOT EXISTS gridstream_draftprospectranking (
    id BIGSERIAL PRIMARY KEY,
    season INTEGER NOT NULL,
    source VARCHAR(80) NOT NULL,
    source_label VARCHAR(120) NOT NULL,
    source_analyst VARCHAR(80) NOT NULL DEFAULT '',
    source_outlet VARCHAR(80) NOT NULL DEFAULT '',
    source_url VARCHAR(500) NOT NULL DEFAULT '',
    source_updated DATE,
    rank INTEGER NOT NULL,
    name VARCHAR(120) NOT NULL,
    name_slug VARCHAR(160) NOT NULL,
    position VARCHAR(20) NOT NULL DEFAULT '',
    school VARCHAR(120) NOT NULL DEFAULT '',
    prospect_id BIGINT REFERENCES gridstream_draftprospect(id) ON DELETE SET NULL,
    scraped_at TIMESTAMPTZ,
    UNIQUE (season, source, name_slug)
);
CREATE INDEX IF NOT EXISTS gs_dpr_season_source_idx ON gridstream_draftprospectranking (season, source);
CREATE INDEX IF NOT EXISTS gs_dpr_season_rank_idx   ON gridstream_draftprospectranking (season, rank);
CREATE INDEX IF NOT EXISTS gs_dpr_slug_season_idx   ON gridstream_draftprospectranking (name_slug, season);
"""

DROP_SQL = "DROP TABLE IF EXISTS gridstream_draftprospectranking;"


class Migration(migrations.Migration):

    dependencies = [
        ("gridstream", "0024_playertransaction_contract_apy_and_more"),
    ]

    operations = [
        migrations.RunSQL(sql=CREATE_SQL, reverse_sql=DROP_SQL),
    ]
