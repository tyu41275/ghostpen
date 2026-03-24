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
import glob
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
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
LLM_ROUTER_URL = os.environ.get("LLM_ROUTER_URL", "http://localhost:8321")

# Known project names mapped to their display names for foundation post matching.
# When a foundation post like "what-is-ecoorchestra.mdx" exists, the generator
# injects a mandatory link reference so the LLM weaves it into the narrative.
# Maps project keys to (display_name, foundation_slug_override).
# Override is used when the foundation post slug doesn't contain the project key
# (e.g., Ghostpen's foundation post is "how-i-built-a-blog-that-writes-itself").
FOUNDATION_PROJECTS: dict[str, tuple[str, str | None]] = {
    "ecoorchestra": ("EcoOrchestra", None),
    "llm-router": ("LLM Router", None),
    "autoagent": ("AutoAgent", None),
    "ghostpen": ("Ghostpen", "how-i-built-a-blog-that-writes-itself"),
    "streamwatcher": ("StreamWatcher", None),
    "frame-intelligence": ("Frame Intelligence", None),
    "myoojik": ("Myoojik", None),
}

# Known concepts (significant features/architectural ideas) that may need foundation posts.
# Maps concept_key (used for slug matching) to (display_name, foundation_slug_override).
# Keep in sync with the "Concepts" table in data/style-guide.md.
FOUNDATION_CONCEPTS: dict[str, tuple[str, str | None]] = {
    "ultravision": ("Ultravision", "what-is-ultravision"),
    "traffic-cop": ("Traffic Cop", "what-is-traffic-cop"),
    "war-room": ("War Room", "what-is-war-room"),
}


def build_foundation_registry() -> str:
    """Scan data/blog/ for foundation posts and build a link registry.

    Returns a markdown section to inject into the generation prompt,
    instructing the LLM to link to foundation posts on first mention
    of each project. This enforces the style guide rule that feature
    posts must reference foundation posts, never GitHub repos.
    """
    if not BLOG_DIR.exists():
        return ""

    # Build set of available slugs from blog directory
    _DATE_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-(.+)$")
    available_slugs: dict[str, str] = {}  # slug -> blog_path
    for post_file in sorted(BLOG_DIR.glob("*.mdx")):
        name = post_file.stem
        m = _DATE_PREFIX_RE.match(name)
        slug = m.group(1) if m else name
        available_slugs[slug.lower()] = f"/blog/{slug}"

    registry: list[str] = []
    for project_key, (display_name, override_slug) in FOUNDATION_PROJECTS.items():
        # Check override slug first (for non-standard foundation post names)
        if override_slug and override_slug.lower() in available_slugs:
            blog_path = available_slugs[override_slug.lower()]
            registry.append(f"- {display_name} -> [{display_name}]({blog_path})")
            continue
        # Fall back to matching project key in slug
        for slug, blog_path in available_slugs.items():
            if project_key in slug:
                registry.append(f"- {display_name} -> [{display_name}]({blog_path})")
                break

    if not registry:
        return ""

    lines = [
        "\n## Foundation Post Links (MANDATORY)",
        "When mentioning these projects, you MUST link to their foundation post on first mention.",
        "Never link to GitHub repos — always use these internal blog links.\n",
    ]
    lines.extend(registry)
    lines.append("")
    return "\n".join(lines)


def scan_for_unlinked_concepts(content: str) -> None:
    """Scan draft post content for recurring concepts that lack foundation posts.

    For each concept in FOUNDATION_CONCEPTS that appears in the draft, checks
    whether a foundation post exists and whether the concept is mentioned in 2+
    existing blog posts. Prints an advisory warning for concepts that meet both
    conditions — advisory only, never blocks post generation.
    """
    if not BLOG_DIR.exists():
        return

    _DATE_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-(.+)$")

    # Build set of existing slugs
    available_slugs: set[str] = set()
    for post_file in BLOG_DIR.glob("*.mdx"):
        name = post_file.stem
        m = _DATE_PREFIX_RE.match(name)
        slug = m.group(1) if m else name
        available_slugs.add(slug.lower())

    # Read all existing post bodies for cross-reference counting
    all_post_contents: list[str] = []
    for post_file in BLOG_DIR.glob("*.mdx"):
        try:
            all_post_contents.append(post_file.read_text(encoding="utf-8").lower())
        except OSError:
            continue

    content_lower = content.lower()
    warnings: list[str] = []

    # Also collect backtick-quoted terms from the draft as candidate concept names
    backtick_terms: set[str] = {
        m.group(1).lower().lstrip("/")
        for m in re.finditer(r"`([^`]+)`", content)
        if 2 <= len(m.group(1)) <= 40
    }

    for concept_key, (display_name, override_slug) in FOUNDATION_CONCEPTS.items():
        concept_lower = display_name.lower()
        concept_slug_term = concept_key.lower()

        # Check if the concept appears in the draft content or as a backtick term
        in_draft = (
            concept_lower in content_lower
            or concept_slug_term in content_lower
            or concept_lower.replace(" ", "-") in backtick_terms
            or concept_slug_term in backtick_terms
        )
        if not in_draft:
            continue

        # Check if a foundation post already exists for this concept
        has_foundation = False
        if override_slug and override_slug.lower() in available_slugs:
            has_foundation = True
        if not has_foundation:
            for slug in available_slugs:
                if concept_slug_term in slug:
                    has_foundation = True
                    break
        if has_foundation:
            continue

        # Count existing posts that mention this concept
        mention_count = sum(
            1 for post_body in all_post_contents
            if concept_lower in post_body or concept_slug_term in post_body
        )

        if mention_count >= 2:
            warnings.append(
                f"  '{display_name}' — referenced in {mention_count} post(s) without a dedicated explainer."
            )

    if warnings:
        print("\nAdvisory — consider writing foundation post(s) before publishing:")
        for w in warnings:
            print(w)
        print(
            "  These are advisory only. Add foundation posts to FOUNDATION_CONCEPTS in generate_post.py\n"
            "  and data/style-guide.md once they are written.\n"
        )


# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------


def find_blogworthy_feature(
    feature_slug: str, artifacts_dir: Path
) -> dict | None:
    """Check if a vision brief exists for the feature (blog-worthiness test).

    Returns the matching approval entry or None.
    """
    # Check vision briefs directory for a matching file
    briefs = list(
        (artifacts_dir / "decisions" / "vision-briefs").glob(f"*{feature_slug}*")
    )
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
    artifacts: dict = {"feature": feature_slug, "vision_brief": None,
                       "standups": [], "reviews": [], "research": [], "screenshots": []}

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
                if feature_slug in content.lower() or feature_slug.replace("-", " ") in content.lower():
                    artifacts["standups"].append(content)

    # 3. Review files — search for reviews mentioning the feature
    for review_file in artifacts_dir.rglob("reviews/*"):
        if not review_file.is_file():
            continue
        name_lower = review_file.name.lower()
        if feature_slug in name_lower:
            try:
                artifacts["reviews"].append(review_file.read_text(encoding="utf-8"))
            except OSError:
                continue

    # 4. Research docs — scan research/ for files matching the feature slug (up to 3)
    research_dir = artifacts_dir / "research"
    if research_dir.exists():
        matched_research = [
            f for f in sorted(research_dir.glob("*.md"))
            if feature_slug in f.name.lower()
        ]
        for research_file in matched_research[:3]:
            try:
                artifacts["research"].append(research_file.read_text(encoding="utf-8"))
            except OSError:
                continue

    # 5. Screenshots
    screenshots_dir = artifacts_dir / "screenshots"
    if screenshots_dir.exists():
        for img in screenshots_dir.glob(f"*{feature_slug}*"):
            if img.is_file() and img.suffix.lower() in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
                artifacts["screenshots"].append(img)

    return artifacts


def generate_post(artifacts: dict, style_guide: str) -> str:
    """Call Anthropic API to generate the blog post body."""
    # Build user prompt from artifacts
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

    if artifacts.get("research"):
        parts.append("## Research Documents\n")
        for i, doc in enumerate(artifacts["research"][:3], 1):
            parts.append(f"### Research {i}\n{doc}\n")

    if artifacts["screenshots"]:
        parts.append(f"\n(There are {len(artifacts['screenshots'])} screenshots available for this feature.)\n")

    # Inject foundation post links so the LLM references them on first mention
    foundation_section = build_foundation_registry()
    if foundation_section:
        parts.append(foundation_section)

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
        print(f"Error: Cannot connect to Anthropic API at {LLM_ROUTER_URL}")
        print("Make sure the Anthropic API server is running: python -m llm_router.server")
        sys.exit(1)
    except requests.HTTPError as exc:
        print(f"Error: Anthropic API returned {exc.response.status_code}: {exc.response.text}")
        sys.exit(1)
    except requests.Timeout:
        print("Error: Anthropic API request timed out after 120 seconds.")
        sys.exit(1)

    data = resp.json()
    content_blocks = data.get("content", [])
    return chr(10).join(b.get("text", "") for b in content_blocks if b.get("type") == "text")


def write_post(feature_slug: str, content: str, title: str | None = None) -> Path:
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
        # Return path relative to public/ for use in markdown
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
            capture_output=True, text=True
        )

    # Create and switch to branch
    result = git("checkout", "-b", branch)
    if result.returncode != 0:
        # Branch may already exist
        git("checkout", branch)

    # Stage files
    git("add", str(post_path.relative_to(BLOG_ROOT)))

    images_dir = BLOG_IMAGES_DIR / slug
    if images_dir.exists():
        git("add", str(images_dir.relative_to(BLOG_ROOT)))

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


def sanitize_title_for_cli(title: str) -> str:
    """Strip characters from an LLM-generated title that could cause shell issues."""
    # Keep alphanumeric, spaces, hyphens, colons, and basic punctuation
    sanitized = re.sub(r"[^\w\s\-:.,!?()'/]", "", title)
    # Collapse whitespace
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
    if blog_post_exists(feature_slug):
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

    # 5. Generate the blog post via Anthropic API
    content = generate_post(artifacts, style_guide)
    if not content:
        print("Error: LLM returned empty content.")
        sys.exit(1)

    # 5a. Advisory: warn about recurring concepts that lack foundation posts
    scan_for_unlinked_concepts(content)

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
