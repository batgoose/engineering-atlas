from rest_framework.test import APITestCase
from rest_framework import status
from django.urls import reverse
from .models import Category, Competency, Artifact, ArtifactCompetency


class AtlasApiTests(APITestCase):
    def setUp(self):
        """
        Runs before every test. We set up a mini-database here.
        """
        # 1. Create a Category
        self.cat_backend = Category.objects.create(name="Backend", display_order=1)

        # 2. Create a Competency (The Skill)
        self.comp_python = Competency.objects.create(
            id="python",
            name="Python",
            category=self.cat_backend,
            competency_type="language",
            proficiency="Expert",
            summary="Primary language.",
        )

        # 3. Create an Artifact (The Project)
        self.project_atlas = Artifact.objects.create(
            id="engineering-atlas",
            title="Engineering Atlas",
            status="in-progress",
            complexity="advanced",
            demo_type="live-site",
            description="The mothership project.",
        )

        # 4. Link them (The Relation)
        ArtifactCompetency.objects.create(
            artifact=self.project_atlas, competency=self.comp_python, role="primary"
        )

    def test_get_competencies(self):
        """
        Test 1: Ensure we can fetch skills and they contain the correct data structure.
        """
        url = reverse("competency-list")  # Looks up /api/competencies/
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(len(response.data) > 0)

        # Verify the structure matches our Serializer
        first_item = response.data[0]
        self.assertEqual(first_item["name"], "Python")
        self.assertEqual(first_item["category"]["name"], "Backend")

        # Verify custom fields exist
        self.assertIn("related_competencies", first_item)
        self.assertIn("sub_competencies", first_item)

    def test_get_artifacts_with_sorting(self):
        """
        Test 2: Ensure projects load and skills are sorted by role (Primary first).
        """
        url = reverse("artifact-list")  # Looks up /api/artifacts/
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Check the specific project
        project = next(
            item for item in response.data if item["id"] == "engineering-atlas"
        )
        self.assertEqual(project["title"], "Engineering Atlas")

        # Verify the nested competency data
        skills = project["competencies"]
        self.assertTrue(len(skills) > 0)
        self.assertEqual(skills[0]["name"], "Python")
        self.assertEqual(skills[0]["role"], "primary")

    def test_artifact_filtering(self):
        """
        Test 3: Test that we can filter projects by status.
        """
        # Create a dummy "Planned" project
        Artifact.objects.create(
            id="future-ai",
            title="Future AI",
            status="planned",
            complexity="advanced",
            demo_type="case-study",
            description="Drake Maye is overrated.",
        )

        # Filter for only 'in-progress' (should match our Atlas project)
        url = reverse("artifact-list") + "?status=in-progress"
        response = self.client.get(url)

        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], "engineering-atlas")
