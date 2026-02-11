from django.test import TestCase


class RedzoneModelTests(TestCase):
    databases = {"nfl"}  # Required for multi-db test setup

    def test_placeholder(self):
        """Placeholder — real tests coming in Phase 1."""
        self.assertTrue(True)
