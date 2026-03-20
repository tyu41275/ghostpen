# Ghostpen

AI-powered blog that automatically drafts posts from development pipeline artifacts — standups, vision briefs, code reviews, and fix loops — in the author's writing style. Built on [tailwind-nextjs-starter-blog](https://github.com/timlrx/tailwind-nextjs-starter-blog).

## How it works

```
EcoOrchestra pipeline    →   Post-ship hook     →   Generator script    →   Draft PR
(standups, vision briefs,    (fires after /ship,     (reads artifacts,       (draft: true .mdx,
 reviews, fix loops)          checks blog-worthy)     calls llm-router,       user reviews,
                                                      writes in your voice)   merges to publish)
```

1. **You ship features** through the normal development pipeline
2. **A post-ship hook** detects blog-worthy features (anything with a vision brief)
3. **A generator script** reads the pipeline artifacts, loads a writing style guide, and calls [llm-router](https://github.com/tyu41275/llm-router) to draft a blog post
4. **Playwright screenshots** captured at pipeline moments are included as visual evidence
5. **A draft PR** is created — you review, edit via Sveltia CMS or code, and merge to publish

AI-generated posts are transparently labeled with an `aiGenerated` frontmatter field and a banner on the post.

## Content

- **Sitecore** — Hands-on troubleshooting posts from real client engagements (written by hand)
- **AI** — Auto-generated posts about building AI-augmented development tools (drafted by AI, reviewed before publishing)

## Local development

```bash
# Install dependencies — uses yarn (pinned to 3.6.1 via packageManager)
yarn install

# Start the dev server — runs Next.js on http://localhost:3000
yarn dev

# Production build — processes .mdx files via contentlayer, then builds Next.js
yarn build
```

## Generating a blog post

Requires [llm-router](https://github.com/tyu41275/llm-router) running on localhost:8000.

```bash
# Generate a draft post for a shipped feature
python scripts/generate_post.py --feature <feature-slug>

# The feature slug must match a vision brief in EcoOrchestra
# e.g. python scripts/generate_post.py --feature anthropic-failover-strategy
```

The script reads EcoOrchestra artifacts, generates a draft `.mdx` with `draft: true` and `aiGenerated: true`, copies screenshots, and opens a draft PR.

## Editing posts

- **Code:** Edit `.mdx` files directly in `data/blog/`
- **CMS:** Navigate to `/admin` on the deployed site for a visual editor powered by [Sveltia CMS](https://github.com/sveltia/sveltia-cms) (requires GitHub OAuth setup via Cloudflare Worker)

## Writing a post manually

Add a `.mdx` file to `data/blog/` with this frontmatter:

```yaml
---
title: 'Your post title'
date: '2026-03-20'
lastmod: '2026-03-20'
tags: ['sitecore', 'troubleshooting']
draft: false
aiGenerated: false
summary: 'Brief description for the post list'
authors: ['default']
images: []
---
```

Images go in `public/static/images/<post-slug>/`.

## Stack

- **[Next.js](https://nextjs.org/) 14** — React framework with App Router
- **[Tailwind CSS](https://tailwindcss.com/)** — Utility-first CSS
- **[contentlayer2](https://github.com/timlrx/contentlayer2)** — MDX content processing with type-safe frontmatter
- **[Sveltia CMS](https://github.com/sveltia/sveltia-cms)** — Git-backed visual editor at `/admin`
- **[Vercel](https://vercel.com/)** — Hosting with automatic deploys on push

## Part of the ecosystem

Ghostpen consumes [EcoOrchestra](https://github.com/tyu41275/EcoOrchestra) pipeline artifacts (standups, vision briefs, reviews). The generator script lives here; the post-ship hook lives in `~/.claude/hooks/`. EcoOrchestra stays generic and shareable.

## Credits

Based on [Tailwind Nextjs Starter Blog](https://github.com/timlrx/tailwind-nextjs-starter-blog) by [Timothy Lin](https://www.timlrx.com).
