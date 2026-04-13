"""Content assembly for blog post generation.

Gathers EcoOrchestra pipeline artifacts, builds foundation post registries,
and calls the LLM router to generate blog post body text.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: 'requests' is required. Install it with: pip install requests")
    sys.exit(1)

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

_DATE_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-(.+)$")


def build_foundation_registry(blog_dir: Path) -> str:
    """Scan data/blog/ for foundation posts and build a link registry.

    Returns a markdown section to inject into the generation prompt,
    instructing the LLM to link to foundation posts on first mention
    of each project. This enforces the style guide rule that feature
    posts must reference foundation posts, never GitHub repos.
    """
    if not blog_dir.exists():
        return ""

    # Build set of available slugs from blog directory
    available_slugs: dict[str, str] = {}  # slug -> blog_path
    for post_file in sorted(blog_dir.glob("*.mdx")):
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


def scan_for_unlinked_concepts(content: str, blog_dir: Path) -> None:
    """Scan draft post content for recurring concepts that lack foundation posts.

    For each concept in FOUNDATION_CONCEPTS that appears in the draft, checks
    whether a foundation post exists and whether the concept is mentioned in 2+
    existing blog posts. Prints an advisory warning for concepts that meet both
    conditions — advisory only, never blocks post generation.
    """
    if not blog_dir.exists():
        return

    # Build set of existing slugs
    available_slugs: set[str] = set()
    for post_file in blog_dir.glob("*.mdx"):
        name = post_file.stem
        m = _DATE_PREFIX_RE.match(name)
        slug = m.group(1) if m else name
        available_slugs.add(slug.lower())

    # Read all existing post bodies for cross-reference counting
    all_post_contents: list[str] = []
    for post_file in blog_dir.glob("*.mdx"):
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
            "  These are advisory only. Add foundation posts to FOUNDATION_CONCEPTS in post_content.py\n"
            "  and data/style-guide.md once they are written.\n"
        )


def find_blogworthy_feature(
    feature_slug: str, artifacts_dir: Path
) -> dict | None:
    """Check if a vision brief exists for the feature (blog-worthiness test).

    Returns the matching approval entry or None.
    """
    import json

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


def blog_post_exists(feature_slug: str, blog_dir: Path) -> bool:
    """Check if a blog post already exists for this feature."""
    return bool(list(blog_dir.glob(f"*{feature_slug}*")))


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


def generate_post_content(
    artifacts: dict, style_guide: str, blog_dir: Path, llm_router_url: str
) -> str:
    """Call LLM router to generate the blog post body."""
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
    foundation_section = build_foundation_registry(blog_dir)
    if foundation_section:
        parts.append(foundation_section)

    parts.append(
        "\nGenerate ONLY the markdown body of the blog post (no frontmatter). "
        "Write in the style described in the system prompt."
    )

    user_prompt = "\n".join(parts)

    url = f"{llm_router_url}/route"
    payload = {
        "prompt": user_prompt,
        "system": style_guide,
        "max_tokens": 4096,
    }

    try:
        resp = requests.post(url, json=payload, timeout=120)
        resp.raise_for_status()
    except requests.ConnectionError:
        print(f"Error: Cannot connect to LLM router at {llm_router_url}")
        print("Make sure the LLM router server is running: python -m llm_router.server")
        sys.exit(1)
    except requests.HTTPError as exc:
        print(f"Error: LLM router returned {exc.response.status_code}: {exc.response.text}")
        sys.exit(1)
    except requests.Timeout:
        print("Error: LLM router request timed out after 120 seconds.")
        sys.exit(1)

    data = resp.json()
    content_blocks = data.get("content", [])
    return chr(10).join(b.get("text", "") for b in content_blocks if b.get("type") == "text")
