from rest_framework.test import APITestCase
from rest_framework import status
from django.urls import reverse
from .models import Category, Competency, Artifact, ArtifactCompetency


class AtlasApiTests(APITestCase):
    def setUp(self):
        self.cat_backend = Category.objects.create(name="Backend", display_order=1)

        self.comp_python = Competency.objects.create(
            id="python",
            name="Python",
            category=self.cat_backend,
            competency_type="language",
            proficiency="Expert",
            summary="Primary language.",
        )

        self.project_atlas = Artifact.objects.create(
            id="engineering-atlas",
            title="Engineering Atlas",
            status="in-progress",
            domain="atlas",
            demo_type="live-site",
            description="The mothership project.",
        )

        ArtifactCompetency.objects.create(
            artifact=self.project_atlas, competency=self.comp_python, role="primary"
        )

    def test_get_competencies(self):
        url = reverse("competency-list")
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(len(response.data) > 0)

        first_item = response.data[0]
        self.assertEqual(first_item["name"], "Python")
        self.assertEqual(first_item["category"]["name"], "Backend")

        self.assertIn("related_competencies", first_item)
        self.assertIn("sub_competencies", first_item)

    def test_get_artifacts_with_sorting(self):
        url = reverse("artifact-list")
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        project = next(
            item for item in response.data if item["id"] == "engineering-atlas"
        )
        self.assertEqual(project["title"], "Engineering Atlas")

        skills = project["competencies"]
        self.assertTrue(len(skills) > 0)
        self.assertEqual(skills[0]["name"], "Python")
        self.assertEqual(skills[0]["role"], "primary")

    def test_artifact_filtering(self):
        Artifact.objects.create(
            id="future-ai",
            title="Future AI",
            status="planned",
            domain="football",
            demo_type="case-study",
            description="Drake Maye is overrated.",
        )

        url = reverse("artifact-list") + "?status=in-progress"
        response = self.client.get(url)

        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], "engineering-atlas")
