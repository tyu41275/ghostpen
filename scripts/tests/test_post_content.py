"""Tests for post_content module — foundation registry, artifact gathering, and concept scanning."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from post_content import (
    FOUNDATION_CONCEPTS,
    FOUNDATION_PROJECTS,
    blog_post_exists,
    build_foundation_registry,
    find_blogworthy_feature,
    gather_artifacts,
    scan_for_unlinked_concepts,
)


@pytest.fixture
def blog_dir(tmp_path):
    d = tmp_path / "blog"
    d.mkdir()
    return d


@pytest.fixture
def artifacts_dir(tmp_path):
    d = tmp_path / "artifacts"
    d.mkdir()
    (d / "decisions" / "vision-briefs").mkdir(parents=True)
    (d / "standups").mkdir()
    (d / "reviews").mkdir()
    (d / "research").mkdir()
    (d / "screenshots").mkdir()
    return d


class TestBuildFoundationRegistry:
    def test_empty_blog_dir(self, blog_dir):
        result = build_foundation_registry(blog_dir)
        assert result == ""

    def test_nonexistent_blog_dir(self, tmp_path):
        result = build_foundation_registry(tmp_path / "nonexistent")
        assert result == ""

    def test_matches_project_key_in_slug(self, blog_dir):
        (blog_dir / "what-is-ecoorchestra.mdx").write_text("---\ntitle: test\n---\n")
        result = build_foundation_registry(blog_dir)
        assert "EcoOrchestra" in result
        assert "/blog/what-is-ecoorchestra" in result
        assert "MANDATORY" in result

    def test_matches_override_slug(self, blog_dir):
        (blog_dir / "how-i-built-a-blog-that-writes-itself.mdx").write_text("---\ntitle: test\n---\n")
        result = build_foundation_registry(blog_dir)
        assert "Ghostpen" in result
        assert "/blog/how-i-built-a-blog-that-writes-itself" in result

    def test_strips_date_prefix_from_slug(self, blog_dir):
        (blog_dir / "2026-03-15-what-is-ecoorchestra.mdx").write_text("---\ntitle: test\n---\n")
        result = build_foundation_registry(blog_dir)
        assert "EcoOrchestra" in result
        assert "/blog/what-is-ecoorchestra" in result

    def test_no_match_returns_empty(self, blog_dir):
        (blog_dir / "unrelated-topic.mdx").write_text("---\ntitle: test\n---\n")
        result = build_foundation_registry(blog_dir)
        assert result == ""

    def test_multiple_projects_matched(self, blog_dir):
        (blog_dir / "what-is-ecoorchestra.mdx").write_text("---\ntitle: test\n---\n")
        (blog_dir / "what-is-llm-router.mdx").write_text("---\ntitle: test\n---\n")
        result = build_foundation_registry(blog_dir)
        assert "EcoOrchestra" in result
        assert "LLM Router" in result


class TestBlogPostExists:
    def test_no_match(self, blog_dir):
        assert blog_post_exists("nonexistent-feature", blog_dir) is False

    def test_exact_slug_match(self, blog_dir):
        (blog_dir / "my-feature.mdx").write_text("content")
        assert blog_post_exists("my-feature", blog_dir) is True

    def test_date_prefixed_match(self, blog_dir):
        (blog_dir / "2026-04-01-my-feature.mdx").write_text("content")
        assert blog_post_exists("my-feature", blog_dir) is True

    def test_partial_match(self, blog_dir):
        (blog_dir / "2026-04-01-my-feature-extended.mdx").write_text("content")
        assert blog_post_exists("my-feature", blog_dir) is True


class TestFindBlogworthyFeature:
    def test_no_vision_brief(self, artifacts_dir):
        result = find_blogworthy_feature("nonexistent", artifacts_dir)
        assert result is None

    def test_vision_brief_exists_no_approvals(self, artifacts_dir):
        brief = artifacts_dir / "decisions" / "vision-briefs" / "my-feature.md"
        brief.write_text("# My Feature\nSome content")
        result = find_blogworthy_feature("my-feature", artifacts_dir)
        assert result is not None
        assert result["feature"] == "my-feature"
        assert result["brief_path"] == str(brief)

    def test_vision_brief_with_matching_approval(self, artifacts_dir):
        brief = artifacts_dir / "decisions" / "vision-briefs" / "cool-feature.md"
        brief.write_text("# Cool Feature")
        approvals = [{"feature": "cool-feature", "approved": True}]
        approvals_path = artifacts_dir / "decisions" / "vision-approvals.json"
        approvals_path.write_text(json.dumps(approvals))
        result = find_blogworthy_feature("cool-feature", artifacts_dir)
        assert result is not None
        assert result["approved"] is True
        assert result["brief_path"] == str(brief)

    def test_vision_brief_with_no_matching_approval(self, artifacts_dir):
        brief = artifacts_dir / "decisions" / "vision-briefs" / "cool-feature.md"
        brief.write_text("# Cool Feature")
        approvals = [{"feature": "other-feature", "approved": True}]
        approvals_path = artifacts_dir / "decisions" / "vision-approvals.json"
        approvals_path.write_text(json.dumps(approvals))
        result = find_blogworthy_feature("cool-feature", artifacts_dir)
        assert result is not None
        assert result["feature"] == "cool-feature"


class TestGatherArtifacts:
    def test_empty_artifacts(self, artifacts_dir):
        result = gather_artifacts("my-feature", artifacts_dir)
        assert result["feature"] == "my-feature"
        assert result["vision_brief"] is None
        assert result["standups"] == []
        assert result["reviews"] == []
        assert result["research"] == []
        assert result["screenshots"] == []

    def test_gathers_vision_brief(self, artifacts_dir):
        brief = artifacts_dir / "decisions" / "vision-briefs" / "my-feature.md"
        brief.write_text("# My Feature\nBrief content here")
        result = gather_artifacts("my-feature", artifacts_dir)
        assert "Brief content here" in result["vision_brief"]

    def test_gathers_standup_entries(self, artifacts_dir):
        day_dir = artifacts_dir / "standups" / "2026-04-14"
        day_dir.mkdir()
        (day_dir / "developer.md").write_text("Worked on my-feature today")
        result = gather_artifacts("my-feature", artifacts_dir)
        assert len(result["standups"]) == 1
        assert "my-feature" in result["standups"][0]

    def test_standup_match_with_spaces(self, artifacts_dir):
        day_dir = artifacts_dir / "standups" / "2026-04-14"
        day_dir.mkdir()
        (day_dir / "developer.md").write_text("Worked on my feature today")
        result = gather_artifacts("my-feature", artifacts_dir)
        assert len(result["standups"]) == 1

    def test_gathers_reviews(self, artifacts_dir):
        (artifacts_dir / "reviews" / "2026-04-14-my-feature.md").write_text("Review findings")
        result = gather_artifacts("my-feature", artifacts_dir)
        assert len(result["reviews"]) == 1

    def test_gathers_research(self, artifacts_dir):
        (artifacts_dir / "research" / "2026-04-14-my-feature.md").write_text("Research doc")
        result = gather_artifacts("my-feature", artifacts_dir)
        assert len(result["research"]) == 1

    def test_research_limited_to_3(self, artifacts_dir):
        for i in range(5):
            (artifacts_dir / "research" / f"my-feature-{i}.md").write_text(f"Doc {i}")
        result = gather_artifacts("my-feature", artifacts_dir)
        assert len(result["research"]) == 3

    def test_gathers_screenshots(self, artifacts_dir):
        (artifacts_dir / "screenshots" / "my-feature-result.png").write_bytes(b"\x89PNG")
        result = gather_artifacts("my-feature", artifacts_dir)
        assert len(result["screenshots"]) == 1

    def test_ignores_non_image_screenshots(self, artifacts_dir):
        (artifacts_dir / "screenshots" / "my-feature-notes.txt").write_text("not an image")
        result = gather_artifacts("my-feature", artifacts_dir)
        assert len(result["screenshots"]) == 0


class TestScanForUnlinkedConcepts:
    def test_no_concepts_in_content(self, blog_dir, capsys):
        scan_for_unlinked_concepts("Just a regular blog post", blog_dir)
        captured = capsys.readouterr()
        assert "Advisory" not in captured.out

    def test_concept_with_foundation_post_no_warning(self, blog_dir, capsys):
        (blog_dir / "what-is-ultravision.mdx").write_text("---\ntitle: UV\n---\n")
        scan_for_unlinked_concepts("This post mentions Ultravision", blog_dir)
        captured = capsys.readouterr()
        assert "Advisory" not in captured.out

    def test_concept_without_foundation_warns_when_mentioned_enough(self, blog_dir, capsys):
        (blog_dir / "post-a.mdx").write_text("We used the traffic cop for routing")
        (blog_dir / "post-b.mdx").write_text("The traffic cop handles dispatch")
        scan_for_unlinked_concepts("The Traffic Cop routes requests", blog_dir)
        captured = capsys.readouterr()
        assert "Traffic Cop" in captured.out

    def test_concept_without_foundation_no_warn_if_rare(self, blog_dir, capsys):
        (blog_dir / "post-a.mdx").write_text("unrelated content")
        scan_for_unlinked_concepts("The Traffic Cop routes requests", blog_dir)
        captured = capsys.readouterr()
        assert "Advisory" not in captured.out

    def test_nonexistent_blog_dir(self, tmp_path, capsys):
        scan_for_unlinked_concepts("Ultravision content", tmp_path / "missing")
        captured = capsys.readouterr()
        assert captured.out == ""
