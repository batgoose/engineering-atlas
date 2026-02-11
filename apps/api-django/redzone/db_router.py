"""
Database router for the Redzone app.

Routes all redzone models to the 'nfl' database (nfl_data),
keeping them separate from the atlas_db used by the core app.
This allows the Redzone platform to be extracted as a standalone
project in the future.
"""


class RedzoneRouter:
    """Route all redzone app models to the nfl database."""

    redzone_apps = {"redzone"}

    def db_for_read(self, model, **hints):
        if model._meta.app_label in self.redzone_apps:
            return "nfl"
        return None  # Fall through to default

    def db_for_write(self, model, **hints):
        if model._meta.app_label in self.redzone_apps:
            return "nfl"
        return None

    def allow_relation(self, obj1, obj2, **hints):
        """Allow relations only within the same database."""
        app1 = obj1._meta.app_label
        app2 = obj2._meta.app_label
        # Both in redzone → OK (same DB)
        if app1 in self.redzone_apps and app2 in self.redzone_apps:
            return True
        # Both NOT in redzone → OK (same DB)
        if app1 not in self.redzone_apps and app2 not in self.redzone_apps:
            return True
        # Cross-database → deny
        return False

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        """Ensure redzone models only migrate on the nfl DB."""
        if app_label in self.redzone_apps:
            return db == "nfl"
        # Non-redzone apps should NOT migrate on nfl DB
        if db == "nfl":
            return False
        return None  # Fall through to default
