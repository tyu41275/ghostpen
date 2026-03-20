# Ghostpen

A blog that automatically drafts posts from your development work -- using AI to turn structured artifacts (decision records, daily logs, code reviews) into blog posts written in your voice.

Built on [tailwind-nextjs-starter-blog](https://github.com/timlrx/tailwind-nextjs-starter-blog).

## The idea

Developers solve interesting problems every day but rarely write about them. The context is fresh during development but stale by the time you sit down to blog. Ghostpen captures that context automatically and drafts posts while the details are still there.

It works by reading structured artifacts that your development process produces -- things like:

- **Decision records** -- why you chose approach A over B, what trade-offs you considered
- **Daily logs** -- what you built, what broke, what you learned
- **Code reviews** -- what bugs were caught, what patterns were flagged
- **Screenshots** -- captured automatically at key moments (build start, review findings, QA pass)

A generator script feeds these artifacts plus a writing style guide to an LLM, which drafts a blog post in your voice. The draft lands as a pull request for you to review and edit before publishing.

## How it works

```
Your dev artifacts     ->   Generator script    ->   Draft PR        ->   Published post
(decision records,         (reads artifacts,        (draft: true,        (you review,
 daily logs, reviews,       loads style guide,       opens PR)            flip draft flag,
 screenshots)               calls Anthropic API)                          Vercel deploys)
```

The generator can be triggered manually (`python scripts/generate_post.py --feature <slug>`) or by a post-ship hook that fires after you merge a PR. It only generates posts for features that have a decision record -- the heuristic for "this is worth writing about."

AI-generated posts are transparently labeled with an `aiGenerated` frontmatter field and a banner on the post.

## Content

This blog has two categories:

- **Sitecore** -- Hands-on troubleshooting posts from real client engagements (written by hand)
- **AI** -- Posts about building AI-augmented development tools (drafted by AI from development artifacts, reviewed before publishing)

## Local development

```bash
# Install dependencies -- uses yarn (pinned to 3.6.1 via packageManager)
yarn install

# Start the dev server -- runs Next.js on http://localhost:3000
yarn dev

# Production build -- processes .mdx files via contentlayer, then builds Next.js
yarn build
```

## Generating a blog post

Requires an `ANTHROPIC_API_KEY` environment variable. Get one at [console.anthropic.com](https://console.anthropic.com/).

```bash
# Generate a draft post for a shipped feature
python scripts/generate_post.py --feature <feature-slug>
```

The feature slug must match a decision record in your artifacts directory. The script reads the artifacts, generates a draft `.mdx` with `draft: true` and `aiGenerated: true`, copies any associated screenshots, and opens a draft PR.

### What are artifacts?

Artifacts are structured files your development process produces. Ghostpen was built alongside an AI development pipeline that generates these naturally, but you can adapt the generator to read whatever your workflow produces -- commit messages, PR descriptions, Notion docs, or plain markdown notes. The key is that the source material is structured and machine-readable.

### Configuring the artifacts directory

By default, the generator looks for artifacts in `C:/Repos/EcoOrchestra` (the development pipeline this blog was built with). Set the `ECOORCHESTRA_DIR` environment variable to point to your own artifacts directory, or modify `scripts/generate_post.py` to read from your preferred source.

## Customizing your voice

Replace `data/style-guide.md` with a style guide based on your own existing writing. The generator uses this file as the system prompt -- your voice, your patterns, your anti-patterns. The included style guide is specific to this blog's author and should be rewritten when forking.

## Editing posts

- **Code:** Edit `.mdx` files directly in `data/blog/`
- **CMS:** Navigate to `/admin` on the deployed site for a visual editor powered by [Sveltia CMS](https://github.com/sveltia/sveltia-cms) -- a git-backed editor that commits changes directly to your repo (requires one-time GitHub OAuth setup via a Cloudflare Worker)

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

- **[Next.js](https://nextjs.org/) 14** -- React framework with App Router
- **[Tailwind CSS](https://tailwindcss.com/)** -- Utility-first CSS
- **[contentlayer2](https://github.com/timlrx/contentlayer2)** -- MDX content processing with type-safe frontmatter
- **[Sveltia CMS](https://github.com/sveltia/sveltia-cms)** -- Git-backed visual editor at `/admin`
- **[Vercel](https://vercel.com/)** -- Hosting with automatic deploys on push

## DependenciesGhostpen has a strong dependency on [EcoOrchestra](https://github.com/tyu41275/EcoOrchestra), which produces the structured artifacts the generator reads (decision records, daily standups, code reviews). EcoOrchestra is currently a private repository but may be made public in the future. If you are forking Ghostpen, you will need to either:- Set up your own EcoOrchestra instance (once it is public), or- Modify `scripts/generate_post.py` to read artifacts from your own source -- any directory of structured markdown files will workThe blog itself (Next.js, contentlayer, Sveltia CMS) has no dependency on EcoOrchestra. Only the generator script requires it.

## Credits

Based on [Tailwind Nextjs Starter Blog](https://github.com/timlrx/tailwind-nextjs-starter-blog) by [Timothy Lin](https://www.timlrx.com).
