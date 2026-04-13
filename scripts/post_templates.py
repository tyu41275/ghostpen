"""Template rendering for blog post generation.

Handles frontmatter construction, .mdx file writing, screenshot copying,
and git branch/PR creation for generated blog posts.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from datetime import date
from pathlib import Path


def sanitize_title_for_cli(title: str) -> str:
    """Strip characters from an LLM-generated title that could cause shell issues."""
    # Keep alphanumeric, spaces, hyphens, colons, and basic punctuation
    sanitized = re.sub(r"[^\w\s\-:.,!?()'/]", "", title)
    # Collapse whitespace
    sanitized = re.sub(r"\s+", " ", sanitized).strip()
    return sanitized or "Untitled"


def write_post(
    feature_slug: str,
    content: str,
    blog_dir: Path,
    title: str | None = None,
) -> Path:
    """Write the .mdx file with frontmatter."""
    today = date.today().isoformat()
    slug = f"{today}-{feature_slug}"

    if not title:
        # Derive title from slug
        title = feature_slug.replace("-", " ").title()

    # Extract first sentence as summary
    first_line = content.strip().split("\n")[0] if content.strip() else title
    # Strip markdown heading markers for the summary
    summary = first_line.lstrip("#").strip()
    if len(summary) > 200:
        summary = summary[:197] + "..."

    # Build relevant tags from feature slug keywords
    tags = ["ai", "dev-log"]
    keywords = feature_slug.split("-")
    for kw in keywords[:3]:
        if kw not in ("the", "a", "an", "and", "or", "for", "in", "of", "to"):
            if kw not in tags:
                tags.append(kw)

    # Escape single quotes in title (same as summary)
    safe_title = title.replace("'", "''")

    frontmatter = f"""---
title: '{safe_title}'
date: '{today}'
tags: {json.dumps(tags)}
draft: true
aiGenerated: true
summary: '{summary.replace("'", "''")}'
images: []
authors: ['default']
---

"""

    blog_dir.mkdir(parents=True, exist_ok=True)
    post_path = blog_dir / f"{slug}.mdx"
    with open(post_path, "w", encoding="utf-8") as f:
        f.write(frontmatter)
        f.write(content)

    print(f"Wrote blog post: {post_path}")
    return post_path


def copy_screenshots(
    feature_slug: str, screenshots: list[Path], blog_images_dir: Path
) -> list[str]:
    """Copy screenshots to the blog's public images directory."""
    if not screenshots:
        return []

    today = date.today().isoformat()
    slug = f"{today}-{feature_slug}"
    dest_dir = blog_images_dir / slug
    dest_dir.mkdir(parents=True, exist_ok=True)

    image_paths = []
    for src in screenshots:
        dest = dest_dir / src.name
        shutil.copy2(src, dest)
        # Return path relative to public/ for use in markdown
        rel = f"/static/images/{slug}/{src.name}"
        image_paths.append(rel)
        print(f"Copied screenshot: {src.name} -> {dest}")

    return image_paths


def create_pr(
    feature_slug: str,
    title: str,
    post_path: Path,
    blog_root: Path,
    blog_images_dir: Path,
) -> None:
    """Create a git branch, commit, push, and open a draft PR."""
    today = date.today().isoformat()
    slug = f"{today}-{feature_slug}"
    branch = f"blog/{feature_slug}"
    repo_dir = str(blog_root)

    def git(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", "-C", repo_dir] + list(args),
            capture_output=True, text=True
        )

    # Create and switch to branch
    result = git("checkout", "-b", branch)
    if result.returncode != 0:
        # Branch may already exist
        git("checkout", branch)

    # Stage files
    git("add", str(post_path.relative_to(blog_root)))

    images_dir = blog_images_dir / slug
    if images_dir.exists():
        git("add", str(images_dir.relative_to(blog_root)))

    # Commit
    commit_msg = f"blog: add AI-generated draft — {title}"
    result = git("commit", "-m", commit_msg)
    if result.returncode != 0:
        print(f"Warning: git commit issue: {result.stderr.strip()}")
        return

    # Push
    result = git("push", "-u", "origin", branch)
    if result.returncode != 0:
        print(f"Warning: git push failed: {result.stderr.strip()}")
        return

    # Open draft PR
    brief_path = f"decisions/vision-briefs/*{feature_slug}*"
    body = (
        "AI-generated draft blog post. Review and flip `draft: false` to publish.\n\n"
        f"Generated from: `{brief_path}`"
    )
    safe_pr_title = sanitize_title_for_cli(title)
    pr_result = subprocess.run(
        ["gh", "pr", "create",
         "--base", "main",
         "--title", f"Blog: {safe_pr_title}",
         "--body", body,
         "--draft"],
        capture_output=True, text=True, cwd=repo_dir
    )
    if pr_result.returncode == 0:
        print(f"Created draft PR: {pr_result.stdout.strip()}")
    else:
        print(f"Warning: PR creation failed: {pr_result.stderr.strip()}")
