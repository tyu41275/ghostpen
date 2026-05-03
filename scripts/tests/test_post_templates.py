"""Tests for post_templates module — frontmatter writing, screenshot copying, and title sanitization."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from post_templates import copy_screenshots, sanitize_title_for_cli, write_post


class TestSanitizeTitleForCli:
    def test_plain_title(self):
        assert sanitize_title_for_cli("Hello World") == "Hello World"

    def test_strips_shell_unsafe_chars(self):
        assert sanitize_title_for_cli('Title with "quotes" and $vars') == "Title with quotes and vars"

    def test_preserves_safe_punctuation(self):
        result = sanitize_title_for_cli("What's the Deal: A Story!")
        assert ":" in result
        assert "!" in result
        assert "'" in result

    def test_collapses_whitespace(self):
        assert sanitize_title_for_cli("Too   many   spaces") == "Too many spaces"

    def test_empty_returns_untitled(self):
        assert sanitize_title_for_cli("$$$") == "Untitled"

    def test_strips_backticks(self):
        assert "`" not in sanitize_title_for_cli("Code: `bash` example")


class TestWritePost:
    @patch("post_templates.date")
    def test_creates_mdx_file(self, mock_date, tmp_path):
        mock_date.today.return_value.isoformat.return_value = "2026-04-14"
        blog_dir = tmp_path / "blog"
        blog_dir.mkdir()
        path = write_post("my-feature", "Post body here.", blog_dir, "My Feature Title")
        assert path.exists()
        assert path.name == "2026-04-14-my-feature.mdx"

    @patch("post_templates.date")
    def test_frontmatter_fields(self, mock_date, tmp_path):
        mock_date.today.return_value.isoformat.return_value = "2026-04-14"
        blog_dir = tmp_path / "blog"
        blog_dir.mkdir()
        write_post("test-feature", "Some content.", blog_dir, "Test Title")
        content = (blog_dir / "2026-04-14-test-feature.mdx").read_text()
        assert "title: 'Test Title'" in content
        assert "date: '2026-04-14'" in content
        assert "draft: true" in content
        assert "aiGenerated: true" in content
        assert "authors: ['default']" in content

    @patch("post_templates.date")
    def test_tags_include_ai_and_devlog(self, mock_date, tmp_path):
        mock_date.today.return_value.isoformat.return_value = "2026-04-14"
        blog_dir = tmp_path / "blog"
        blog_dir.mkdir()
        write_post("cool-stuff", "Content.", blog_dir, "Title")
        content = (blog_dir / "2026-04-14-cool-stuff.mdx").read_text()
        assert '"ai"' in content
        assert '"dev-log"' in content

    @patch("post_templates.date")
    def test_summary_truncation(self, mock_date, tmp_path):
        mock_date.today.return_value.isoformat.return_value = "2026-04-14"
        blog_dir = tmp_path / "blog"
        blog_dir.mkdir()
        long_first_line = "A" * 300
        write_post("long-post", long_first_line + "\nMore content.", blog_dir, "Title")
        content = (blog_dir / "2026-04-14-long-post.mdx").read_text()
        assert "..." in content

    @patch("post_templates.date")
    def test_derives_title_from_slug_when_none(self, mock_date, tmp_path):
        mock_date.today.return_value.isoformat.return_value = "2026-04-14"
        blog_dir = tmp_path / "blog"
        blog_dir.mkdir()
        write_post("cool-feature", "Content.", blog_dir)
        content = (blog_dir / "2026-04-14-cool-feature.mdx").read_text()
        assert "Cool Feature" in content

    @patch("post_templates.date")
    def test_escapes_single_quotes_in_title(self, mock_date, tmp_path):
        mock_date.today.return_value.isoformat.return_value = "2026-04-14"
        blog_dir = tmp_path / "blog"
        blog_dir.mkdir()
        write_post("quote-test", "Content.", blog_dir, "It's a Test")
        content = (blog_dir / "2026-04-14-quote-test.mdx").read_text()
        assert "It''s a Test" in content

    @patch("post_templates.date")
    def test_creates_blog_dir_if_missing(self, mock_date, tmp_path):
        mock_date.today.return_value.isoformat.return_value = "2026-04-14"
        blog_dir = tmp_path / "new" / "blog"
        path = write_post("feat", "Content.", blog_dir, "Title")
        assert path.exists()

    @patch("post_templates.date")
    def test_body_content_after_frontmatter(self, mock_date, tmp_path):
        mock_date.today.return_value.isoformat.return_value = "2026-04-14"
        blog_dir = tmp_path / "blog"
        blog_dir.mkdir()
        write_post("my-feat", "The actual post body.", blog_dir, "Title")
        content = (blog_dir / "2026-04-14-my-feat.mdx").read_text()
        assert content.endswith("The actual post body.")


class TestCopyScreenshots:
    def test_empty_list(self, tmp_path):
        result = copy_screenshots("feat", [], tmp_path / "images")
        assert result == []

    @patch("post_templates.date")
    def test_copies_files(self, mock_date, tmp_path):
        mock_date.today.return_value.isoformat.return_value = "2026-04-14"
        src = tmp_path / "src"
        src.mkdir()
        img = src / "screenshot.png"
        img.write_bytes(b"\x89PNG")

        images_dir = tmp_path / "images"
        result = copy_screenshots("my-feat", [img], images_dir)
        assert len(result) == 1
        assert "/static/images/2026-04-14-my-feat/screenshot.png" in result[0]
        assert (images_dir / "2026-04-14-my-feat" / "screenshot.png").exists()

    @patch("post_templates.date")
    def test_multiple_screenshots(self, mock_date, tmp_path):
        mock_date.today.return_value.isoformat.return_value = "2026-04-14"
        src = tmp_path / "src"
        src.mkdir()
        (src / "a.png").write_bytes(b"\x89PNG")
        (src / "b.jpg").write_bytes(b"\xff\xd8")

        images_dir = tmp_path / "images"
        result = copy_screenshots("feat", [src / "a.png", src / "b.jpg"], images_dir)
        assert len(result) == 2
