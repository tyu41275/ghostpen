# Ghostpen

A blog that drafts posts from your development work -- using AI to turn your decision records, notes, issues and pull requests into blog posts written in your voice, each one approved by you before it publishes.

**Live site:** [timyu-blog.vercel.app](https://timyu-blog.vercel.app)

Built on [tailwind-nextjs-starter-blog](https://github.com/timlrx/tailwind-nextjs-starter-blog).

## The idea

Developers solve interesting problems every day but rarely write about them. The context is fresh during development but stale by the time you sit down to blog. Ghostpen captures that context automatically and drafts posts while the details are still there.

It works by reading the sources its settings name (decision records, experiment notes, a glossary of the setup's parts, GitHub issues and pull requests) and ranking each candidate topic by the value it gives a reader. Each week it proposes a short list in its chatter channel; a **Write** drafts the topic in your voice and opens the post as a pull request with a preview, and **Publish** lands it once its review approves. Nothing is published without your press.

## How it works

```
Configured sources    ->   Ranking + weekly    ->   Draft PR             ->   Published post
(decisions, notes,         shortlist               (checked: plain words,      (Publish merges it
 glossary, issues/PRs)     (Write, Skip, Not yet)   links, diagrams,           after review,
                                                    screenshots)               Vercel deploys)
```

ghostpen runs as an optional chatter adapter (`adapter/`, see `adapter/docs/adapter.md`): what it reads is `adapter/docs/sources.md`, the ranking `adapter/docs/ranking.md`, the shortlist `adapter/docs/shortlist.md`, drafting and its checks `adapter/docs/drafting.md`, and publishing `adapter/docs/publishing.md`. The post-ship hook, the Python generator it ran and the "has a decision record, so it's worth writing about" rule are retired (Obsidian ADR 0101).

AI-generated posts are transparently labeled with an `aiGenerated` frontmatter field and a banner on the post.

## Content

This blog has two categories:

- **Sitecore** -- Hands-on troubleshooting posts from real client engagements (written by hand)
- **AI** -- Posts about building AI-augmented development tools (drafted by ghostpen's adapter from its sources, reviewed before publishing)

## Content folder

The build reads its content from the folder the environment variable `GHOSTPEN_CONTENT_DIR` names (an absolute path).
Before Next.js and Contentlayer run, `scripts/content.js` copies it into the git-ignored `.content/` folder the build reads:

```
site.json          # the site's own values: title, author, siteUrl (required), description, links, and the home
                   # page's `home` block (name, avatar, role, links, aiTag, sourceRepo, howItWorks)
authors/           # author profiles; default.mdx is the blog's author (required)
blog/              # the .mdx posts (required)
images/            # served at /static/images/ (copied into public/static/images/ and removed again on the next run)
*.bib              # optional bibliographies for posts with a `bibliography` field
```

A folder that is missing, relative or incomplete stops the build with an error naming `GHOSTPEN_CONTENT_DIR`. Without the
variable the build still uses the repository's own content (`data/`, `data/site.legacy.js`), which is to be removed;
`GHOSTPEN_REQUIRE_CONTENT=1` refuses that and requires the variable. `content-sample/` is a small generic folder:

```bash
GHOSTPEN_CONTENT_DIR=$PWD/content-sample yarn build
```

## Deploying the live site

The live site is built on the deploy host from its content folder, and only the built site goes to Vercel: the content
never leaves the host. `scripts/deploy-site.sh` installs the dependencies, then runs a pinned Vercel CLI to pull the
project's settings, build (`yarn build`, with `GHOSTPEN_REQUIRE_CONTENT=1`) and deploy the prebuilt site to production.
It prints the deployment's URL. It reads four inputs from the environment:

- `GHOSTPEN_CONTENT_DIR`: the content folder (above).
- `VERCEL_TOKEN_FILE`: a file holding a Vercel token, readable only by the service user (`VERCEL_TOKEN` also works,
  but leaves the token in the process environment).
- `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`: the Vercel team and project.

`scripts/deploy-site.sh --build-only` pulls and builds without deploying, as a check. Vercel's own Git builds, such as
those of pull requests, have no content folder and show the sample or legacy content.

## Local development

```bash
# Install dependencies -- uses yarn (pinned to 3.6.1 via packageManager)
yarn install

# Start the dev server -- runs Next.js on http://localhost:3000
yarn dev

# Production build -- processes .mdx files via contentlayer, then builds Next.js
yarn build
```

## Customizing your voice

Replace `data/style-guide.md` with a style guide based on your own existing writing. The draft writer reads the file its settings name (`draft.styleGuide`, `adapter/docs/drafting.md`) beside your recent published posts -- your voice, your patterns, your anti-patterns. The included style guide is specific to this blog's author and should be rewritten when forking.

## Editing posts

- **Code:** Edit `.mdx` files directly in `data/blog/`
- **CMS:** Navigate to the `/admin` page on the deployed site for a visual editor powered by [Sveltia CMS](https://github.com/sveltia/sveltia-cms) -- a git-backed editor that commits changes directly to your repo (requires one-time GitHub OAuth setup via a Cloudflare Worker)

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

Images go in `public/static/images/<slug>/` where `<slug>` matches the `.mdx` filename.

## Stack

- **[Next.js](https://nextjs.org/) 14** -- React framework with App Router
- **[Tailwind CSS](https://tailwindcss.com/)** -- Utility-first CSS
- **[contentlayer2](https://github.com/timlrx/contentlayer2)** -- MDX content processing with type-safe frontmatter
- **[Sveltia CMS](https://github.com/sveltia/sveltia-cms)** -- Git-backed visual editor (see `public/admin/`)
- **[Vercel](https://vercel.com/)** -- Hosting with automatic deploys on push

## Dependencies

The blog itself (Next.js, contentlayer, Sveltia CMS) needs nothing else. The drafting side is ghostpen's chatter adapter in `adapter/`: it needs a chatter instance to run it, and reads only the sources its settings name (`adapter/docs/install.md`).

## Credits

Based on [Tailwind Nextjs Starter Blog](https://github.com/timlrx/tailwind-nextjs-starter-blog) by [Timothy Lin](https://www.timlrx.com).
