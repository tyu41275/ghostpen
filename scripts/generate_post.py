#!/usr/bin/env python3
"""Blog post generator — reads EcoOrchestra pipeline artifacts and generates
draft blog posts via the llm-router HTTP API.

Usage:
    python scripts/generate_post.py --feature <feature-slug>
    python scripts/generate_post.py --feature <feature-slug> --artifacts-dir /path/to/EcoOrchestra

Requires: requests (pip install requests)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: 'requests' is required. Install it with: pip install requests")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
BLOG_ROOT = SCRIPT_DIR.parent
BLOG_DIR = BLOG_ROOT / "data" / "blog"
STYLE_GUIDE_PATH = BLOG_ROOT / "data" / "style-guide.md"
BLOG_IMAGES_DIR = BLOG_ROOT / "public" / "static" / "images"
LLM_ROUTER_URL = os.environ.get("LLM_ROUTER_URL", "http://localhost:8000")

# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------


def find_blogworthy_feature(
    feature_slug: str, artifacts_dir: Path
) -> dict | None:
    """Check if a vision brief exists for the feature (blog-worthiness test).

    Returns the matching approval entry or None.
    """
    briefs_dir = artifacts_dir / "decisions" / "vision-briefs"
    if not briefs_dir.exists():
        return None

    briefs = list(briefs_dir.glob(f"*{feature_slug}*"))
    if not briefs:
        return None

    # Optionally pull metadata from vision-approvals.json
    approvals_path = artifacts_dir / "decisions" / "vision-approvals.json"
    if approvals_path.exists():
        with open(approvals_path, "r", encoding="utf-8") as f:
            approvals = json.load(f)
        for entry in approvals:
            if entry.get("feature", "") == feature_slug:
                entry["brief_path"] = str(briefs[0])
                return entry

    # Vision brief exists but no approval entry — still blog-worthy
    return {"feature": feature_slug, "brief_path": str(briefs[0])}


def blog_post_exists(feature_slug: str) -> bool:
    """Check if a blog post already exists for this feature."""
    return bool(list(BLOG_DIR.glob(f"*{feature_slug}*")))


def gather_artifacts(feature_slug: str, artifacts_dir: Path) -> dict:
    """Gather all available artifacts for a feature."""
    artifacts: dict = {
        "feature": feature_slug,
        "vision_brief": None,
        "standups": [],
        "reviews": [],
        "screenshots": [],
    }

    # 1. Vision brief
    briefs = list(
        (artifacts_dir / "decisions" / "vision-briefs").glob(f"*{feature_slug}*")
    )
    if briefs:
        with open(briefs[0], "r", encoding="utf-8") as f:
            artifacts["vision_brief"] = f.read()

    # 2. Standup entries — scan recent dates for mentions of the feature
    standups_dir = artifacts_dir / "standups"
    if standups_dir.exists():
        for day_dir in sorted(standups_dir.iterdir(), reverse=True)[:7]:
            if not day_dir.is_dir():
                continue
            for md_file in day_dir.glob("*.md"):
                try:
                    content = md_file.read_text(encoding="utf-8")
                except OSError:
                    continue
                slug_lower = feature_slug.lower()
                content_lower = content.lower()
                if slug_lower in content_lower or slug_lower.replace("-", " ") in content_lower:
                    artifacts["standups"].append(content)

    # 3. Review files — search for reviews mentioning the feature
    for review_file in artifacts_dir.rglob("reviews/*"):
        if not review_file.is_file():
            continue
        if feature_slug in review_file.name.lower():
            try:
                artifacts["reviews"].append(review_file.read_text(encoding="utf-8"))
            except OSError:
                continue

    # 4. Screenshots
    screenshots_dir = artifacts_dir / "screenshots"
    if screenshots_dir.exists():
        for img in screenshots_dir.glob(f"*{feature_slug}*"):
            if img.is_file() and img.suffix.lower() in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
                artifacts["screenshots"].append(img)

    return artifacts


def generate_post(artifacts: dict, style_guide: str) -> str:
    """Call llm-router to generate the blog post body."""
    parts = [f"Write a blog post about the '{artifacts['feature']}' feature.\n"]

    if artifacts["vision_brief"]:
        parts.append("## Vision Brief\n")
        parts.append(artifacts["vision_brief"])
        parts.append("")

    if artifacts["standups"]:
        parts.append("## Standup Entries\n")
        for i, entry in enumerate(artifacts["standups"][:5], 1):
            parts.append(f"### Entry {i}\n{entry}\n")

    if artifacts["reviews"]:
        parts.append("## Review Findings\n")
        for i, review in enumerate(artifacts["reviews"][:3], 1):
            parts.append(f"### Review {i}\n{review}\n")

    if artifacts["screenshots"]:
        parts.append(
            f"\n(There are {len(artifacts['screenshots'])} screenshots "
            f"available for this feature.)\n"
        )

    parts.append(
        "\nGenerate ONLY the markdown body of the blog post (no frontmatter). "
        "Write in the style described in the system prompt."
    )

    user_prompt = "\n".join(parts)

    url = f"{LLM_ROUTER_URL}/route"
    payload = {
        "prompt": user_prompt,
        "system": style_guide,
        "max_tokens": 4096,
    }

    try:
        resp = requests.post(url, json=payload, timeout=120)
        resp.raise_for_status()
    except requests.ConnectionError:
        print(f"Error: Cannot connect to llm-router at {LLM_ROUTER_URL}")
        print("Make sure the llm-router server is running: python -m llm_router.server")
        sys.exit(1)
    except requests.HTTPError as exc:
        print(f"Error: llm-router returned {exc.response.status_code}: {exc.response.text}")
        sys.exit(1)
    except requests.Timeout:
        print("Error: llm-router request timed out after 120 seconds.")
        sys.exit(1)

    data = resp.json()
    return data.get("raw_text", "")


def write_post(feature_slug: str, content: str, title: str | None = None) -> Path:
    """Write the .mdx file with frontmatter."""
    today = date.today().isoformat()
    slug = f"{today}-{feature_slug}"

    if not title:
        title = feature_slug.replace("-", " ").title()

    # Extract first sentence as summary
    first_line = content.strip().split("\n")[0] if content.strip() else title
    summary = first_line.lstrip("#").strip()
    if len(summary) > 200:
        summary = summary[:197] + "..."

    # Build relevant tags from feature slug keywords
    tags = ["ai", "dev-log"]
    skip_words = {"the", "a", "an", "and", "or", "for", "in", "of", "to"}
    for kw in feature_slug.split("-")[:3]:
        if kw not in skip_words and kw not in tags:
            tags.append(kw)

    safe_title = title.replace("'", "''")

    frontmatter = f"""---
title: '{safe_title}'
date: '{today}'
tags: {json.dumps(tags)}
draft: true
aiGenerated: true
summary: '{summary.replace(chr(39), chr(39)+chr(39))}'
images: []
authors: ['default']
---

"""

    BLOG_DIR.mkdir(parents=True, exist_ok=True)
    post_path = BLOG_DIR / f"{slug}.mdx"
    with open(post_path, "w", encoding="utf-8") as f:
        f.write(frontmatter)
        f.write(content)

    print(f"Wrote blog post: {post_path}")
    return post_path


def copy_screenshots(feature_slug: str, screenshots: list[Path]) -> list[str]:
    """Copy screenshots to the blog's public images directory."""
    if not screenshots:
        return []

    today = date.today().isoformat()
    slug = f"{today}-{feature_slug}"
    dest_dir = BLOG_IMAGES_DIR / slug
    dest_dir.mkdir(parents=True, exist_ok=True)

    image_paths = []
    for src in screenshots:
        dest = dest_dir / src.name
        shutil.copy2(src, dest)
        rel = f"/static/images/{slug}/{src.name}"
        image_paths.append(rel)
        print(f"Copied screenshot: {src.name} -> {dest}")

    return image_paths


def create_pr(feature_slug: str, title: str, post_path: Path) -> None:
    """Create a git branch, commit, push, and open a draft PR."""
    today = date.today().isoformat()
    slug = f"{today}-{feature_slug}"
    branch = f"blog/{feature_slug}"
    repo_dir = str(BLOG_ROOT)

    def git(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", "-C", repo_dir] + list(args),
            capture_output=True, text=True,
        )

    # Create and switch to branch
    result = git("checkout", "-b", branch)
    if result.returncode != 0:
        git("checkout", branch)

    # Stage files
    git("add", str(post_path.relative_to(BLOG_ROOT)))

    images_dir = BLOG_IMAGES_DIR / slug
    if images_dir.exists():
        git("add", str(images_dir.relative_to(BLOG_ROOT)))

    # Commit
    commit_msg = f"blog: add AI-generated draft \u2014 {title}"
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
    pr_result = subprocess.run(
        ["gh", "pr", "create",
         "--base", "main",
         "--title", f"Blog: {sanitize_title_for_cli(title)}",
         "--body", body,
         "--draft"],
        capture_output=True, text=True, cwd=repo_dir,
    )
    if pr_result.returncode == 0:
        print(f"Created draft PR: {pr_result.stdout.strip()}")
    else:
        print(f"Warning: PR creation failed: {pr_result.stderr.strip()}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a draft blog post from EcoOrchestra pipeline artifacts.",
    )
    parser.add_argument(
        "--feature", required=True,
        help="Feature slug (e.g. 'anthropic-failover')",
    )
    parser.add_argument(
        "--artifacts-dir",
        default=os.environ.get("ECOORCHESTRA_DIR", "C:/Repos/EcoOrchestra"),
        help="Path to EcoOrchestra directory (default: C:/Repos/EcoOrchestra or $ECOORCHESTRA_DIR)",
    )
    return parser.parse_args()


def sanitize_title_for_cli(title: str) -> str:
    """Strip characters from an LLM-generated title that could cause shell issues."""
    sanitized = re.sub(r"[^\w\s\-:.,!?()\'/ ]", "", title)
    sanitized = re.sub(r"\s+", " ", sanitized).strip()
    return sanitized or "Untitled"


def main() -> None:
    args = parse_args()
    feature_slug = args.feature

    # Validate feature slug to prevent shell injection
    if not re.match(r"^[a-z0-9][a-z0-9\-]{0,80}$", feature_slug):
        print(
            f"Error: Invalid feature slug '{feature_slug}'. "
            "Must match ^[a-z0-9][a-z0-9-]{{0,80}}$ (lowercase alphanumeric and hyphens only)."
        )
        sys.exit(1)

    artifacts_dir = Path(args.artifacts_dir)

    if not artifacts_dir.exists():
        print(f"Error: Artifacts directory not found: {artifacts_dir}")
        sys.exit(1)

    # 1. Check blog-worthiness (vision brief must exist)
    feature_info = find_blogworthy_feature(feature_slug, artifacts_dir)
    if not feature_info:
        print(f"No vision brief found for '{feature_slug}' \u2014 not blog-worthy")
        sys.exit(0)

    # 2. Check if post already exists
    if blog_post_exists(feature_slug):
        print(f"Blog post already exists for '{feature_slug}' \u2014 skipping")
        sys.exit(0)

    print(f"Feature '{feature_slug}' is blog-worthy. Generating post...")

    # 3. Gather artifacts
    artifacts = gather_artifacts(feature_slug, artifacts_dir)
    brief_lines = (artifacts["vision_brief"] or "").strip().split("\n")
    print(f"  Vision brief: {len(brief_lines)} lines")
    print(f"  Standup entries: {len(artifacts['standups'])}")
    print(f"  Reviews: {len(artifacts['reviews'])}")
    print(f"  Screenshots: {len(artifacts['screenshots'])}")

    # 4. Load style guide
    if not STYLE_GUIDE_PATH.exists():
        print(f"Warning: Style guide not found at {STYLE_GUIDE_PATH}, proceeding without it.")
        style_guide = "Write a technical blog post in a clear, conversational tone."
    else:
        style_guide = STYLE_GUIDE_PATH.read_text(encoding="utf-8")

    # 5. Generate the blog post via llm-router
    content = generate_post(artifacts, style_guide)
    if not content:
        print("Error: LLM returned empty content.")
        sys.exit(1)

    # 6. Derive title from vision brief or feature slug
    title = feature_slug.replace("-", " ").title()
    if artifacts["vision_brief"]:
        for line in artifacts["vision_brief"].split("\n"):
            stripped = line.strip()
            if stripped.startswith("# "):
                title = stripped[2:].strip()
                break

    # 7. Write the .mdx file
    post_path = write_post(feature_slug, content, title)

    # 8. Copy screenshots
    image_paths = copy_screenshots(feature_slug, artifacts["screenshots"])
    if image_paths:
        print(f"  Copied {len(image_paths)} screenshots")

    # 9. Create branch + PR
    create_pr(feature_slug, title, post_path)

    print("Done!")


if __name__ == "__main__":
    main()
