"""
Database router for the Gridstream app.

Routes all gridstream models to the 'nfl' database (nfl_data),
keeping them separate from the atlas_db used by the core app.
This allows the Gridstream platform to be extracted as a standalone
project in the future.
"""


class GridstreamRouter:
    """Route all gridstream app models to NFL database aliases."""

    gridstream_apps = {"gridstream"}
    nfl_db_aliases = {"nfl", "nfl_v1", "nfl_v2"}

    def db_for_read(self, model, **hints):
        if model._meta.app_label in self.gridstream_apps:
            return "nfl"
        return None  # Fall through to default

    def db_for_write(self, model, **hints):
        if model._meta.app_label in self.gridstream_apps:
            return "nfl"
        return None

    def allow_relation(self, obj1, obj2, **hints):
        """Allow relations only within the same database."""
        app1 = obj1._meta.app_label
        app2 = obj2._meta.app_label
        # Both in gridstream → OK (same DB)
        if app1 in self.gridstream_apps and app2 in self.gridstream_apps:
            return True
        # Both NOT in gridstream → OK (same DB)
        if app1 not in self.gridstream_apps and app2 not in self.gridstream_apps:
            return True
        # Cross-database → deny
        return False

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        """Ensure gridstream models only migrate on NFL DB aliases."""
        if app_label in self.gridstream_apps:
            return db in self.nfl_db_aliases
        # Non-gridstream apps should NOT migrate on NFL DB aliases
        if db in self.nfl_db_aliases:
            return False
        return None  # Fall through to default
