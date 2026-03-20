#!/usr/bin/env python3
"""
generate_post.py — Blog post generator for ghostpen.

Reads EcoOrchestra pipeline artifacts (vision briefs, reviews, standups,
screenshots, commit history), calls the llm-router HTTP API, and generates
draft .mdx blog posts.

Modes:
  Single feature:
    python scripts/generate_post.py --feature <slug>
    python scripts/generate_post.py --feature <slug> --dry-run

  Batch backfill:
    python scripts/generate_post.py --backfill [--max-posts 5] [--dry-run]
    python scripts/generate_post.py --backfill --max-posts 3 --dry-run
"""

import argparse
import glob
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Force UTF-8 stdout/stderr on Windows to handle unicode in artifacts
# ---------------------------------------------------------------------------
if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if sys.stderr.encoding != "utf-8":
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ---------------------------------------------------------------------------
# HTTP client — prefer requests, fall back to urllib
# ---------------------------------------------------------------------------
try:
    import requests

    def _get(url, timeout=5):
        resp = requests.get(url, timeout=timeout)
        return resp.status_code, resp.text

    def _post_json(url, payload, timeout=120):
        resp = requests.post(url, json=payload, timeout=timeout)
        return resp.status_code, resp.text

except ImportError:
    import urllib.request
    import urllib.error

    def _get(url, timeout=5):
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode("utf-8")
        except urllib.error.URLError as exc:
            raise ConnectionError(str(exc)) from exc

    def _post_json(url, payload, timeout=120):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode("utf-8")
        except urllib.error.URLError as exc:
            raise ConnectionError(str(exc)) from exc


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
GHOSTPEN_ROOT = SCRIPT_DIR.parent
STYLE_GUIDE = GHOSTPEN_ROOT / "data" / "style-guide.md"
BLOG_DIR = GHOSTPEN_ROOT / "data" / "blog"
IMAGES_DIR = GHOSTPEN_ROOT / "public" / "static" / "images"

DEFAULT_ARTIFACTS_DIR = "C:/Repos/EcoOrchestra"
DEFAULT_LLM_URL = "http://localhost:8321"


# ---------------------------------------------------------------------------
# Artifact collectors
# ---------------------------------------------------------------------------
def find_vision_briefs(artifacts_dir, slug):
    """Return list of vision brief paths matching the slug."""
    pattern = os.path.join(artifacts_dir, "decisions", "vision-briefs", f"*{slug}*")
    return sorted(glob.glob(pattern))


def find_reviews(artifacts_dir, slug):
    """Return list of review paths matching the slug."""
    pattern = os.path.join(artifacts_dir, "reviews", f"*{slug}*")
    return sorted(glob.glob(pattern))


def find_standups(artifacts_dir, slug, days=7):
    """Scan recent standup directories for files mentioning the slug."""
    results = []
    today = datetime.now()
    for i in range(days):
        date_str = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        day_dir = os.path.join(artifacts_dir, "standups", date_str)
        if not os.path.isdir(day_dir):
            continue
        for fname in os.listdir(day_dir):
            fpath = os.path.join(day_dir, fname)
            if not fpath.endswith(".md"):
                continue
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    content = f.read()
                if slug in content.lower() or slug.replace("-", " ") in content.lower():
                    results.append(fpath)
            except OSError:
                continue
    return results


def find_screenshots(artifacts_dir, slug):
    """Return list of screenshot paths matching the slug."""
    pattern = os.path.join(artifacts_dir, "screenshots", f"*{slug}*")
    return sorted(glob.glob(pattern))


def get_commit_history(slug):
    """Get recent commit history mentioning the slug from any repo under C:/Repos."""
    try:
        result = subprocess.run(
            [
                "git",
                "log",
                "--all",
                "--oneline",
                "--since=7 days ago",
                f"--grep={slug}",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=os.environ.get("REPOS_DIR", "C:/Repos"),
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        pass
    return ""


def read_file(path):
    """Read a file and return its contents, or empty string on failure."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except OSError as exc:
        print(f"Warning: could not read {path}: {exc}", file=sys.stderr)
        return ""


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------
def build_prompt(slug, vision_briefs, reviews, standups, screenshots, commit_history):
    """Build the user prompt from collected artifacts."""
    sections = []
    sections.append(
        "Write a blog post about the following feature development:\n"
    )

    # Vision brief(s)
    sections.append("## Vision Brief")
    for path in vision_briefs:
        content = read_file(path)
        if content:
            sections.append(content)

    # Reviews
    if reviews:
        sections.append("\n## Reviews")
        for path in reviews:
            content = read_file(path)
            if content:
                sections.append(content)

    # Standups
    if standups:
        sections.append("\n## Daily Standups")
        for path in standups:
            content = read_file(path)
            if content:
                sections.append(f"### {os.path.basename(os.path.dirname(path))}")
                sections.append(content)

    # Screenshots
    if screenshots:
        sections.append("\n## Screenshots Available")
        for path in screenshots:
            sections.append(f"- {os.path.basename(path)}")

    # Commit history
    if commit_history:
        sections.append("\n## Commit History")
        sections.append(commit_history)

    # Instructions
    sections.append(
        """
## Instructions
- Write in first person as a developer sharing their experience
- Focus on the "why" and decisions made, not just the "what"
- Include code snippets only when they illustrate a key point
- Target 800-1500 words
- Suggest a title and 3-5 tags
- Format the output as: TITLE: <title>
TAGS: <comma-separated>
SUMMARY: <one-line summary>
---
<blog post body in markdown>"""
    )

    return "\n\n".join(sections)


# ---------------------------------------------------------------------------
# LLM interaction
# ---------------------------------------------------------------------------
def check_llm_health(llm_url):
    """Check if llm-router is available. Returns True/False."""
    try:
        status, _ = _get(f"{llm_url}/provider-health", timeout=5)
        return status == 200
    except (ConnectionError, OSError) as exc:
        print(f"llm-router health check failed: {exc}", file=sys.stderr)
        return False


def call_llm(llm_url, user_prompt, system_prompt, slug):
    """Call llm-router and return the response text."""
    payload = {
        "prompt": user_prompt,
        "system": system_prompt,
        "max_tokens": 4096,
        "metadata": {"source": "ghostpen-generator", "feature": slug},
    }
    try:
        status, body = _post_json(f"{llm_url}/route", payload, timeout=120)
    except (ConnectionError, OSError) as exc:
        print(f"Error: llm-router request failed: {exc}", file=sys.stderr)
        sys.exit(1)

    if status != 200:
        print(
            f"Error: llm-router returned status {status}: {body}",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        print("Error: llm-router returned invalid JSON", file=sys.stderr)
        print(f"Raw response: {body[:500]}", file=sys.stderr)
        sys.exit(1)

    # The response field is "text" per the llm-router API spec,
    # but fall back to "raw_text" if present (issue #17 mentions raw_text)
    text = data.get("text") or data.get("raw_text") or ""
    if not text:
        print("Error: llm-router response has no text content", file=sys.stderr)
        print(f"Response keys: {list(data.keys())}", file=sys.stderr)
        sys.exit(1)

    return text


# ---------------------------------------------------------------------------
# Response parsing & MDX generation
# ---------------------------------------------------------------------------
def parse_llm_response(text):
    """Parse TITLE, TAGS, SUMMARY, and body from LLM response text.

    Expected format:
        TITLE: <title>
        TAGS: <comma-separated>
        SUMMARY: <one-line summary>
        ---
        <body>

    Returns (title, tags, summary, body) or raises ValueError.
    """
    title = ""
    tags = []
    summary = ""
    body = ""

    lines = text.strip().split("\n")
    body_start = None

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("TITLE:"):
            title = stripped[len("TITLE:"):].strip()
        elif stripped.startswith("TAGS:"):
            raw_tags = stripped[len("TAGS:"):].strip()
            tags = [t.strip().lower().replace(" ", "-") for t in raw_tags.split(",") if t.strip()]
        elif stripped.startswith("SUMMARY:"):
            summary = stripped[len("SUMMARY:"):].strip()
        elif stripped == "---" and title:
            body_start = i + 1
            break

    if body_start is not None:
        body = "\n".join(lines[body_start:]).strip()

    if not title:
        raise ValueError("Could not parse TITLE from LLM response")
    if not body:
        raise ValueError("Could not parse body from LLM response")

    return title, tags, summary, body


def generate_mdx(slug, title, date_str, tags, summary, body, ai_generated=True):
    """Generate MDX content with YAML frontmatter."""
    # Ensure 'ai-generated' is always in tags
    if "ai-generated" not in tags:
        tags.insert(0, "ai-generated")

    # Escape single quotes in title and summary for YAML
    safe_title = title.replace("'", "''")
    safe_summary = summary.replace("'", "''") if summary else ""

    tag_list = ", ".join(f"'{t}'" for t in tags)

    frontmatter_lines = [
        "---",
        f"title: '{safe_title}'",
        f"date: '{date_str}'",
        f"tags: [{tag_list}]",
        "draft: true",
        f"aiGenerated: {str(ai_generated).lower()}",
    ]
    if safe_summary:
        frontmatter_lines.append(f"summary: '{safe_summary}'")
    frontmatter_lines.extend([
        "images: []",
        "authors: ['default']",
        "---",
    ])

    return "\n".join(frontmatter_lines) + "\n\n" + body + "\n"


def copy_screenshots(screenshots, slug):
    """Copy screenshots to public/static/images/<slug>/ and return image references."""
    if not screenshots:
        return []

    dest_dir = IMAGES_DIR / slug
    dest_dir.mkdir(parents=True, exist_ok=True)

    refs = []
    for src in screenshots:
        fname = os.path.basename(src)
        dest = dest_dir / fname
        try:
            shutil.copy2(src, dest)
            # Generate a description from the filename
            desc = fname.rsplit(".", 1)[0].replace("-", " ").replace("_", " ")
            refs.append(f"![{desc}](/static/images/{slug}/{fname})")
        except OSError as exc:
            print(f"Warning: could not copy {src}: {exc}", file=sys.stderr)

    return refs


def insert_image_refs(body, image_refs):
    """Append image references at the end of the body if any exist."""
    if not image_refs:
        return body
    return body + "\n\n" + "\n\n".join(image_refs) + "\n"


# ---------------------------------------------------------------------------
# Backfill — scanning, scoring, and batch generation
# ---------------------------------------------------------------------------
def extract_slug_from_brief(filename):
    """Extract the feature slug from a vision brief filename.

    Vision brief naming convention: YYYY-MM-DD-<slug>.md
    Returns the slug portion (everything after the date prefix).
    """
    basename = os.path.basename(filename)
    # Strip .md extension
    name = basename.rsplit(".", 1)[0] if basename.endswith(".md") else basename
    # Remove YYYY-MM-DD- prefix
    match = re.match(r"^\d{4}-\d{2}-\d{2}-(.+)$", name)
    if match:
        return match.group(1)
    return name


def get_existing_blog_slugs():
    """Return a set of slugs that already have a blog post in data/blog/."""
    slugs = set()
    if not BLOG_DIR.is_dir():
        return slugs
    for entry in os.listdir(BLOG_DIR):
        if entry.endswith(".mdx") and not entry.endswith(".mdx.disabled"):
            slug = entry.rsplit(".", 1)[0]
            slugs.add(slug)
    return slugs


def load_vision_approvals(artifacts_dir):
    """Load vision-approvals.json and return a dict keyed by feature name.

    Returns {feature_name: {"status": ..., ...}, ...}.
    """
    approvals_path = os.path.join(artifacts_dir, "decisions", "vision-approvals.json")
    if not os.path.isfile(approvals_path):
        return {}
    try:
        with open(approvals_path, "r", encoding="utf-8") as f:
            entries = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        print(f"Warning: could not load vision-approvals.json: {exc}", file=sys.stderr)
        return {}

    approvals = {}
    for entry in entries:
        feature = entry.get("feature", "")
        if feature:
            approvals[feature] = entry
    return approvals


def score_vision_brief(brief_path, slug, artifacts_dir, approvals, existing_slugs):
    """Score a vision brief for blog-worthiness.

    Scoring heuristic (from issue #18):
      - Has "approved" status in vision-approvals.json: +3 points
      - Brief is longer than 500 words (rich content): +2 points
      - Has associated review files: +2 points
      - Has associated standup mentions: +1 point
      - Has associated screenshots: +1 point
      - Feature was rejected/deferred (interesting decision story): +2 points
      - Already has a blog post in data/blog/ with matching slug: -999 (skip)

    Returns (score, reasons_list).
    """
    score = 0
    reasons = []

    # Already has a blog post — skip
    if slug in existing_slugs:
        return -999, ["already has blog post"]

    # Check approval status
    # The approval feature name might not exactly match the slug, so check
    # both the slug and common variations
    approval = approvals.get(slug) or approvals.get(slug.replace("-", "_"))
    # Also try partial matching for cases like "anthropic-failover" vs "anthropic-failover-strategy"
    if not approval:
        for feat_name, feat_data in approvals.items():
            if slug in feat_name or feat_name in slug:
                approval = feat_data
                break

    if approval:
        status = approval.get("status", "").lower()
        if status == "approved":
            score += 3
            reasons.append("approved")
        elif status in ("rejected", "deferred"):
            score += 2
            reasons.append(f"{status} (interesting decision)")

    # Brief word count
    content = read_file(brief_path)
    word_count = len(content.split()) if content else 0
    if word_count > 500:
        score += 2
        reasons.append("rich brief")

    # Associated reviews
    reviews = find_reviews(artifacts_dir, slug)
    if reviews:
        score += 2
        reasons.append("has reviews")

    # Associated standups
    standups = find_standups(artifacts_dir, slug)
    if standups:
        score += 1
        reasons.append("has standups")

    # Associated screenshots
    screenshots = find_screenshots(artifacts_dir, slug)
    if screenshots:
        score += 1
        reasons.append("has screenshots")

    return score, reasons


def scan_and_rank_briefs(artifacts_dir, max_posts):
    """Scan all vision briefs, score them, and return ranked candidates.

    Returns (candidates, total_briefs) where candidates is a list of
    (slug, score, reasons, brief_path) tuples, sorted by score descending,
    limited to max_posts entries. Briefs with score <= 0 are excluded.
    """
    briefs_dir = os.path.join(artifacts_dir, "decisions", "vision-briefs")
    if not os.path.isdir(briefs_dir):
        print(f"Error: vision briefs directory not found: {briefs_dir}", file=sys.stderr)
        sys.exit(1)

    brief_files = sorted(glob.glob(os.path.join(briefs_dir, "*.md")))
    if not brief_files:
        print("No vision briefs found.", file=sys.stderr)
        sys.exit(1)

    approvals = load_vision_approvals(artifacts_dir)
    existing_slugs = get_existing_blog_slugs()

    scored = []
    for brief_path in brief_files:
        slug = extract_slug_from_brief(brief_path)
        score, reasons = score_vision_brief(
            brief_path, slug, artifacts_dir, approvals, existing_slugs
        )
        scored.append((slug, score, reasons, brief_path))

    # Sort by score descending, then alphabetically by slug for ties
    scored.sort(key=lambda x: (-x[1], x[0]))

    total = len(scored)
    # Filter out already-has-blog-post entries (score -999) and zero-score
    candidates = [(s, sc, r, p) for s, sc, r, p in scored if sc > 0]

    return candidates[:max_posts], total


def generate_single_post(slug, artifacts_dir, llm_url, dry_run=False):
    """Generate a single blog post for a given slug.

    Reuses the same artifact collection, prompt building, LLM calling,
    and MDX generation logic as single-feature mode.

    Returns (success: bool, output_path_or_error: str).
    """
    # Gather artifacts
    vision_briefs = find_vision_briefs(artifacts_dir, slug)
    if not vision_briefs:
        return False, f"No vision brief for '{slug}'"

    reviews = find_reviews(artifacts_dir, slug)
    standups = find_standups(artifacts_dir, slug)
    screenshots = find_screenshots(artifacts_dir, slug)
    commit_history = get_commit_history(slug)

    # Build prompt
    system_prompt = read_file(STYLE_GUIDE)
    if not system_prompt:
        return False, f"Could not read style guide at {STYLE_GUIDE}"

    user_prompt = build_prompt(
        slug, vision_briefs, reviews, standups, screenshots, commit_history
    )

    if dry_run:
        return True, f"data/blog/{slug}.mdx (dry run)"

    # Call LLM
    try:
        raw_text = call_llm_safe(llm_url, user_prompt, system_prompt, slug)
    except RuntimeError as exc:
        return False, str(exc)

    # Parse response
    try:
        title, tags, summary, body = parse_llm_response(raw_text)
    except ValueError as exc:
        # Save raw response for manual recovery
        raw_path = BLOG_DIR / f"{slug}.mdx.raw"
        try:
            with open(raw_path, "w", encoding="utf-8") as f:
                f.write(raw_text)
        except OSError:
            pass
        return False, f"Parse error: {exc}"

    # Copy screenshots and insert references
    image_refs = copy_screenshots(screenshots, slug)
    if image_refs:
        body = insert_image_refs(body, image_refs)

    # Generate and write MDX
    date_str = datetime.now().strftime("%Y-%m-%d")
    mdx_content = generate_mdx(slug, title, date_str, tags, summary, body)

    output_path = BLOG_DIR / f"{slug}.mdx"
    try:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(mdx_content)
    except OSError as exc:
        return False, f"Could not write {output_path}: {exc}"

    return True, str(output_path)


def call_llm_safe(llm_url, user_prompt, system_prompt, slug):
    """Call llm-router and return the response text.

    Like call_llm() but raises RuntimeError instead of sys.exit(),
    so batch mode can continue on failure.
    """
    payload = {
        "prompt": user_prompt,
        "system": system_prompt,
        "max_tokens": 4096,
        "metadata": {"source": "ghostpen-generator", "feature": slug},
    }
    try:
        status, body = _post_json(f"{llm_url}/route", payload, timeout=120)
    except (ConnectionError, OSError) as exc:
        raise RuntimeError(f"llm-router request failed: {exc}")

    if status != 200:
        raise RuntimeError(f"llm-router returned status {status}: {body[:200]}")

    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        raise RuntimeError(f"llm-router returned invalid JSON: {body[:200]}")

    text = data.get("text") or data.get("raw_text") or ""
    if not text:
        raise RuntimeError(f"llm-router response has no text content (keys: {list(data.keys())})")

    return text


def run_backfill(args):
    """Run backfill mode: scan, rank, and generate posts for top candidates."""
    artifacts_dir = args.artifacts_dir
    llm_url = args.llm_url
    max_posts = args.max_posts

    # Validate artifacts directory
    if not os.path.isdir(artifacts_dir):
        print(f"Error: artifacts directory not found: {artifacts_dir}", file=sys.stderr)
        sys.exit(1)

    # Scan and rank
    candidates, total_briefs = scan_and_rank_briefs(artifacts_dir, max_posts)

    if not candidates:
        print("No backfill candidates found (all vision briefs already have blog posts or scored 0).")
        sys.exit(0)

    # Print ranked candidate list
    print(f"\nBackfill candidates (top {len(candidates)} of {total_briefs} vision briefs):")
    for i, (slug, score, reasons, _) in enumerate(candidates, 1):
        reason_str = ", ".join(reasons) if reasons else "no signals"
        print(f"  {i}. [score: {score}] {slug} -- {reason_str}")

    if args.dry_run:
        print(f"\nDry run complete -- would generate {len(candidates)} post(s).")
        sys.exit(0)

    # Check llm-router health before starting batch
    if not check_llm_health(llm_url):
        print("Error: llm-router is not available. Start it with:", file=sys.stderr)
        print(f"  cd C:/Repos/llm-router && python -m llm_router.server", file=sys.stderr)
        sys.exit(1)

    # Generate posts sequentially
    generated = []
    failed = []

    for i, (slug, score, reasons, brief_path) in enumerate(candidates, 1):
        print(f"\n[{i}/{len(candidates)}] Generating: {slug}...")

        success, result = generate_single_post(slug, artifacts_dir, llm_url, dry_run=False)

        if success:
            generated.append(result)
            print(f"  OK: {result}")
        else:
            failed.append((slug, result))
            print(f"  FAILED: {result}", file=sys.stderr)

        # Rate-limit delay between LLM calls (skip after last one)
        if i < len(candidates):
            time.sleep(2)

    # Print summary
    print(f"\nBackfill complete:")
    print(f"  Generated: {len(generated)}/{len(candidates)}")
    print(f"  Failed:    {len(failed)}")
    if generated:
        print(f"  Posts created:")
        for path in generated:
            print(f"    - {path}")
    if failed:
        print(f"  Failures:")
        for slug, err in failed:
            print(f"    - {slug}: {err}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Generate draft MDX blog posts from EcoOrchestra artifacts.",
        epilog="Part of the ghostpen AI content pipeline.",
    )

    # Mutually exclusive: --feature (single) vs --backfill (batch)
    mode_group = parser.add_mutually_exclusive_group(required=True)
    mode_group.add_argument(
        "--feature",
        help="Feature slug matching vision brief filename (e.g., 'anthropic-failover')",
    )
    mode_group.add_argument(
        "--backfill",
        action="store_true",
        help="Scan all vision briefs, rank by blog-worthiness, and generate top N posts",
    )

    parser.add_argument(
        "--max-posts",
        type=int,
        default=5,
        help="Maximum number of posts to generate in backfill mode (default: 5)",
    )
    parser.add_argument(
        "--artifacts-dir",
        default=DEFAULT_ARTIFACTS_DIR,
        help=f"Path to EcoOrchestra repo (default: {DEFAULT_ARTIFACTS_DIR})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Gather artifacts and build prompt, but skip LLM call and file generation",
    )
    parser.add_argument(
        "--llm-url",
        default=DEFAULT_LLM_URL,
        help=f"llm-router base URL (default: {DEFAULT_LLM_URL})",
    )

    args = parser.parse_args()

    # Dispatch to backfill mode
    if args.backfill:
        run_backfill(args)
        return

    slug = args.feature
    artifacts_dir = args.artifacts_dir
    llm_url = args.llm_url

    # Validate artifacts directory
    if not os.path.isdir(artifacts_dir):
        print(f"Error: artifacts directory not found: {artifacts_dir}", file=sys.stderr)
        sys.exit(1)

    # -----------------------------------------------------------------------
    # Blog-worthiness check: must have a vision brief
    # -----------------------------------------------------------------------
    vision_briefs = find_vision_briefs(artifacts_dir, slug)
    if not vision_briefs:
        print(f"No vision brief for '{slug}' — not blog-worthy, skipping.")
        sys.exit(0)

    print(f"Found {len(vision_briefs)} vision brief(s) for '{slug}'")

    # -----------------------------------------------------------------------
    # Gather artifacts
    # -----------------------------------------------------------------------
    reviews = find_reviews(artifacts_dir, slug)
    standups = find_standups(artifacts_dir, slug)
    screenshots = find_screenshots(artifacts_dir, slug)
    commit_history = get_commit_history(slug)

    print(f"  Reviews:    {len(reviews)}")
    print(f"  Standups:   {len(standups)}")
    print(f"  Screenshots: {len(screenshots)}")
    print(f"  Commits:    {'yes' if commit_history else 'none'}")

    # -----------------------------------------------------------------------
    # Build prompt
    # -----------------------------------------------------------------------
    system_prompt = read_file(STYLE_GUIDE)
    if not system_prompt:
        print(f"Error: could not read style guide at {STYLE_GUIDE}", file=sys.stderr)
        sys.exit(1)

    user_prompt = build_prompt(
        slug, vision_briefs, reviews, standups, screenshots, commit_history
    )

    # -----------------------------------------------------------------------
    # Dry run — print prompt and exit
    # -----------------------------------------------------------------------
    if args.dry_run:
        print("\n" + "=" * 60)
        print("SYSTEM PROMPT")
        print("=" * 60)
        print(system_prompt[:500] + "..." if len(system_prompt) > 500 else system_prompt)
        print("\n" + "=" * 60)
        print("USER PROMPT")
        print("=" * 60)
        print(user_prompt)
        print("\n" + "=" * 60)
        print(f"Prompt length: {len(user_prompt)} chars")
        print("Dry run complete — no LLM call or file generation.")
        sys.exit(0)

    # -----------------------------------------------------------------------
    # Check llm-router health
    # -----------------------------------------------------------------------
    if not check_llm_health(llm_url):
        print("Error: llm-router is not available. Start it with:", file=sys.stderr)
        print(f"  cd C:/Repos/llm-router && python -m llm_router.server", file=sys.stderr)
        sys.exit(1)

    print("llm-router is healthy, generating post...")

    # -----------------------------------------------------------------------
    # Call LLM
    # -----------------------------------------------------------------------
    raw_text = call_llm(llm_url, user_prompt, system_prompt, slug)

    # -----------------------------------------------------------------------
    # Parse response
    # -----------------------------------------------------------------------
    try:
        title, tags, summary, body = parse_llm_response(raw_text)
    except ValueError as exc:
        # Save raw response for manual recovery
        raw_path = BLOG_DIR / f"{slug}.mdx.raw"
        try:
            with open(raw_path, "w", encoding="utf-8") as f:
                f.write(raw_text)
            print(f"Warning: {exc}", file=sys.stderr)
            print(f"Raw LLM response saved to: {raw_path}", file=sys.stderr)
        except OSError as write_exc:
            print(f"Error: {exc}", file=sys.stderr)
            print(f"Also failed to save raw response: {write_exc}", file=sys.stderr)
        sys.exit(1)

    # -----------------------------------------------------------------------
    # Copy screenshots and insert references
    # -----------------------------------------------------------------------
    image_refs = copy_screenshots(screenshots, slug)
    if image_refs:
        body = insert_image_refs(body, image_refs)

    # -----------------------------------------------------------------------
    # Generate and write MDX
    # -----------------------------------------------------------------------
    date_str = datetime.now().strftime("%Y-%m-%d")
    mdx_content = generate_mdx(slug, title, date_str, tags, summary, body)

    output_path = BLOG_DIR / f"{slug}.mdx"
    try:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(mdx_content)
    except OSError as exc:
        print(f"Error: could not write {output_path}: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"\nGenerated: {output_path}")
    print(f"  Title:  {title}")
    print(f"  Tags:   {', '.join(tags)}")
    print(f"  Draft:  true")
    print(f"  AI:     true")
    if image_refs:
        print(f"  Images: {len(image_refs)} screenshot(s) copied")


if __name__ == "__main__":
    main()
