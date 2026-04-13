#!/usr/bin/env python3
"""Blog post generator — reads EcoOrchestra pipeline artifacts and generates
draft blog posts via the Anthropic API.

Usage:
    python scripts/generate_post.py --feature <feature-slug>
    python scripts/generate_post.py --feature <feature-slug> --artifacts-dir /path/to/EcoOrchestra

Requires: requests (pip install requests)
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

from post_content import (
    blog_post_exists,
    find_blogworthy_feature,
    gather_artifacts,
    generate_post_content,
    scan_for_unlinked_concepts,
)
from post_templates import copy_screenshots, create_pr, write_post

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
BLOG_ROOT = SCRIPT_DIR.parent
BLOG_DIR = BLOG_ROOT / "data" / "blog"
STYLE_GUIDE_PATH = BLOG_ROOT / "data" / "style-guide.md"
BLOG_IMAGES_DIR = BLOG_ROOT / "public" / "static" / "images"
LLM_ROUTER_URL = os.environ.get("LLM_ROUTER_URL", "http://localhost:8321")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a draft blog post from EcoOrchestra pipeline artifacts."
    )
    parser.add_argument(
        "--feature", required=True,
        help="Feature slug (e.g. 'anthropic-failover')"
    )
    parser.add_argument(
        "--artifacts-dir",
        default=os.environ.get("ECOORCHESTRA_DIR", "C:/Repos/EcoOrchestra"),
        help="Path to EcoOrchestra directory (default: C:/Repos/EcoOrchestra or $ECOORCHESTRA_DIR)"
    )
    return parser.parse_args()


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

    # 1. Check blog-worthiness: vision brief must exist OR standalone research docs match
    feature_info = find_blogworthy_feature(feature_slug, artifacts_dir)
    if not feature_info:
        # Fallback: standalone research docs can trigger blog generation without a vision brief
        research_dir = artifacts_dir / "research"
        standalone_research = (
            list(research_dir.glob(f"*{feature_slug}*.md"))
            if research_dir.exists()
            else []
        )
        if not standalone_research:
            print(f"No vision brief or research docs found for '{feature_slug}' — not blog-worthy")
            sys.exit(0)
        print(f"No vision brief for '{feature_slug}', but {len(standalone_research)} research doc(s) found — proceeding via research trigger path.")
        feature_info = {"feature": feature_slug, "brief_path": None}

    # 2. Check if post already exists
    if blog_post_exists(feature_slug, BLOG_DIR):
        print(f"Blog post already exists for '{feature_slug}' — skipping")
        sys.exit(0)

    print(f"Feature '{feature_slug}' is blog-worthy. Generating post...")

    # 3. Gather artifacts
    artifacts = gather_artifacts(feature_slug, artifacts_dir)
    brief_lines = (artifacts["vision_brief"] or "").strip().split("\n")
    print(f"  Vision brief: {len(brief_lines)} lines")
    print(f"  Standup entries: {len(artifacts['standups'])}")
    print(f"  Reviews: {len(artifacts['reviews'])}")
    print(f"  Research docs: {len(artifacts['research'])}")
    print(f"  Screenshots: {len(artifacts['screenshots'])}")

    # 4. Load style guide
    if not STYLE_GUIDE_PATH.exists():
        print(f"Warning: Style guide not found at {STYLE_GUIDE_PATH}, proceeding without it.")
        style_guide = "Write a technical blog post in a clear, conversational tone."
    else:
        style_guide = STYLE_GUIDE_PATH.read_text(encoding="utf-8")

    # 5. Generate the blog post via LLM router
    content = generate_post_content(artifacts, style_guide, BLOG_DIR, LLM_ROUTER_URL)
    if not content:
        print("Error: LLM returned empty content.")
        sys.exit(1)

    # 5a. Advisory: warn about recurring concepts that lack foundation posts
    scan_for_unlinked_concepts(content, BLOG_DIR)

    # 6. Derive title from vision brief, first research doc, or feature slug
    title = feature_slug.replace("-", " ").title()
    if artifacts["vision_brief"]:
        for line in artifacts["vision_brief"].split("\n"):
            line = line.strip()
            if line.startswith("# "):
                title = line.lstrip("# ").strip()
                break
    elif artifacts.get("research"):
        # No vision brief — derive title from first research document heading
        for line in artifacts["research"][0].split("\n"):
            line = line.strip()
            if line.startswith("# "):
                title = line.lstrip("# ").strip()
                break

    # 7. Write the .mdx file
    post_path = write_post(feature_slug, content, BLOG_DIR, title)

    # 8. Copy screenshots
    image_paths = copy_screenshots(feature_slug, artifacts["screenshots"], BLOG_IMAGES_DIR)
    if image_paths:
        print(f"  Copied {len(image_paths)} screenshots")

    # 9. Create branch + PR
    create_pr(feature_slug, title, post_path, BLOG_ROOT, BLOG_IMAGES_DIR)

    print("Done!")


if __name__ == "__main__":
    main()
