# Obsidian One-Click Publishing Workflow Design

**Date:** 2026-08-19  
**Status:** Approved in conversation; awaiting written-spec review  
**Scope:** Windows and macOS publishing from `LinVault` to `LinYeeGiong.github.io`

## 1. Goal

Provide a low-terminal publishing workflow for Lin's personal blog:

```text
Write in Obsidian
-> click "发布当前文章"
-> validate and transform the note
-> copy the public article and its images
-> verify the Astro site
-> commit and push
-> let GitHub Actions deploy
```

Private notes remain in the Obsidian Vault. Only a note explicitly published from an allowed folder enters the public Git repository.

## 2. Directory Contract

The Vault and blog repository are siblings on every computer:

```text
PersonalBlog/
|-- LinVault/
|   |-- 00_Inbox/
|   |-- 10_Notes/
|   |-- 20_Essays/
|   |-- 30_Daily/
|   |-- 40_Pages/
|   |-- Attachments/
|   |-- Templates/
|   `-- Scripts/
`-- LinYeeGiong.github.io/
    |-- src/content/notes/
    |-- src/content/essays/
    |-- src/content/daily/
    |-- public/images/
    `-- scripts/
```

The publisher discovers the blog repository as a sibling of the current Vault. It does not store a Windows-only absolute path, so the same synced Vault configuration works on macOS when the sibling names are unchanged.

## 3. Publishable Content

The source folder determines the collection:

| Vault folder | Astro destination | Public route |
| --- | --- | --- |
| `10_Notes/` | `src/content/notes/` | `/notes/<slug>/` |
| `20_Essays/` | `src/content/essays/` | `/essays/<slug>/` |
| `30_Daily/` | `src/content/daily/` | `/daily/<date>/` |

Notes in `00_Inbox`, `40_Pages`, `Templates`, `Attachments`, or any other folder cannot be published by this command. About-page publishing is outside this first version and remains managed by the Astro site configuration/page.

Deleting a Vault note does not delete its public article. The first version intentionally excludes an unpublish command to prevent accidental removal from the live site.

## 4. Frontmatter Contract

All publishable notes use these fields:

```yaml
---
title: ""
description: ""
date: 2026-08-19
slug: ""
tags: []
lang: zh
published: false
publicationId: ""
---
```

`title`, `description`, and `date` are required. `tags` defaults to an empty array, `lang` defaults to `zh`, and `published` defaults to `false` in new-note templates.

Notes additionally support:

```yaml
series:
readingMinutes:
```

Daily entries additionally support:

```yaml
location:
images: []
```

The publisher generates a UUID `publicationId` on first publication and writes it to both the Vault source and public copy. This stable identity distinguishes a legitimate update from a different note that happens to request the same slug.

The Astro content schema will accept optional `slug` and `publicationId` fields. Astro continues to route by the copied filename; the publisher guarantees that filename and `slug` match.

## 5. Slug And URL Rules

The requested `slug` is resolved in this order:

1. Use a valid frontmatter `slug`.
2. For Daily, use the ISO date `YYYY-MM-DD`.
3. Use a normalized English source filename.
4. Transliterate a Chinese source filename to lowercase pinyin.

Slugs contain lowercase ASCII letters, digits, and single hyphens. Leading, trailing, and repeated hyphens are removed. A slug that becomes empty is rejected with an actionable message.

On first publication, the resolved slug is written back to the Vault note. After that, it is treated as the permanent URL. Changing the slug of an existing `publicationId` is rejected in version one; this avoids silently breaking inbound links. A future explicit migration command can provide redirects and safe URL changes.

## 6. Create, Update, And Conflict Rules

The publisher performs an inspection phase before modifying files:

- **Create:** no public article uses the target collection and slug.
- **Update:** the target article has the same `publicationId`. Obsidian asks for confirmation before continuing.
- **Conflict:** the target exists with another or missing `publicationId`, or the same `publicationId` exists at another slug. Publishing stops without changing files.

An update replaces the public Markdown copy and the article-owned image directory. A different note can never overwrite an existing article merely because its title or slug matches.

## 7. Image Handling

The source note may reference local images inside the Vault using standard Markdown image syntax. `cover` and Daily `images` frontmatter paths are handled as image references as well.

For an article at `notes/agent-memory`, local images are copied to:

```text
public/images/notes/agent-memory/
```

The public Markdown copy uses root-relative URLs such as:

```markdown
![Memory diagram](/images/notes/agent-memory/memory-diagram.png)
```

Rules:

- External `http`, `https`, and data URLs are left unchanged.
- A local image must resolve inside the Vault and must exist.
- Unsafe traversal outside the Vault is rejected.
- Filenames are normalized; collisions receive a short content hash.
- Updating an article replaces only that article's owned image directory, removing stale images safely.
- The original Vault note and its attachment links are not rewritten.
- Obsidian wiki-image embeds are rejected with guidance to use Markdown links; the Vault is already configured to create Markdown links by default.

Markdown is parsed structurally before links are changed. The transformed public copy may have normalized Markdown formatting, while the private source remains untouched except for publication metadata.

## 8. Components

### 8.1 Templater

Templater uses `Templates/` and folder-specific templates:

- `10_Notes` -> note template
- `20_Essays` -> essay template
- `30_Daily` -> Daily template

Templates provide the collection-specific frontmatter and current date. New notes remain drafts until the publish command succeeds.

### 8.2 QuickAdd Bridge

QuickAdd exposes one command named `发布当前文章`. Its small Vault-side JavaScript bridge:

1. Gets the active note and Vault root from the Obsidian API.
2. Locates the sibling `LinYeeGiong.github.io` repository.
3. Calls the repository publisher in inspection mode.
4. Shows the update confirmation when required.
5. Calls execute mode and displays progress, errors, or the final URL.

No shell window is shown and the user does not type npm or Git commands.

### 8.3 Commander

Commander adds a ribbon button using the familiar send icon with tooltip `发布当前文章`. It invokes the QuickAdd command. The button is a convenience surface; the same action remains available in Obsidian's command palette.

### 8.4 Repository Publisher

The cross-platform Node publisher lives under `scripts/` in the personal blog repository. It owns:

- frontmatter parsing and validation;
- slug generation and pinyin transliteration;
- publication identity and collision checks;
- structured Markdown image discovery and rewriting;
- copy staging and exact-file backups;
- dependency bootstrap when `node_modules` does not match `package-lock.json`;
- Astro verification;
- Git synchronization, commit, and push;
- machine-readable JSON results for QuickAdd.

The publisher requires the blog's declared Node version (`>=22.12.0`) and Git. Missing prerequisites produce installation guidance instead of a partial publication.

## 9. Transaction And Git Safety

Before writing public files, the publisher checks:

- the sibling directory is the expected Git repository;
- the current branch tracks `origin/main`;
- the worktree is clean;
- no unresolved or divergent Git state exists;
- the remote can be synchronized with `git pull --rebase`.

The publisher stages transformed output in a temporary directory first. It then writes the source publication metadata and public files while keeping exact backups.

`npm run verify` must pass before a commit is created. If validation fails before commit, the source and repository files are restored from the backups.

After verification, the publisher commits as the configured user with:

```text
content: publish <slug>
```

It then pushes `main`. If push fails after a successful commit, the local commit and source publication metadata remain intact; the UI reports that publication is pending push. The next run first attempts to synchronize and push that clean, ahead commit. It never destroys or resets unrelated user work.

GitHub Actions repeats `npm run verify` and deploys only a successful build. The local publisher reports success only after Git push succeeds; GitHub Pages deployment continues asynchronously.

The repository-local Git identity is:

```text
LinYeeGiong <linyifeng@stu.xmu.edu.cn>
```

## 10. User Feedback

QuickAdd uses Obsidian notices and confirmation dialogs for:

- unsupported source folder;
- missing or invalid frontmatter;
- missing local image;
- slug or publication identity conflict;
- update confirmation;
- dependency installation and verification progress;
- Git authentication or synchronization failure;
- successful push with the final article URL.

Errors name the failing file or field and suggest the next action. Raw command output is retained for diagnostics but concise messages are shown first.

## 11. Testing

Automated tests use Vitest and temporary directories. They do not push to GitHub.

Coverage includes:

- folder-to-collection mapping;
- required and collection-specific frontmatter validation;
- English slug normalization, Chinese pinyin, and Daily date slugs;
- stable `publicationId` creation and update detection;
- slug collision and changed-permalink rejection;
- Markdown, cover, and Daily image copying and URL rewriting;
- missing images, path traversal, and filename collisions;
- clean create/update rollback when verification fails;
- Git command sequencing through an injected command runner;
- JSON protocol consumed by QuickAdd.

Verification before completion consists of:

1. publisher unit and integration tests;
2. the existing complete `npm run verify` suite;
3. a dry-run from the active Windows Vault;
4. inspection that Templater, QuickAdd, and Commander point to the intended files and command;
5. a local temporary-repository publish smoke test, so no test article is pushed to the live blog.

## 12. Explicit Non-Goals For Version One

- Automatic publishing from `00_Inbox`.
- Automatic deletion or unpublishing.
- Permanent-link migration or redirects.
- About-page publishing from Obsidian.
- OpenClaw mobile capture integration.
- Using Obsidian Git as the Vault synchronization mechanism.

These features can be added independently after the one-click desktop publishing path is stable.

## 13. Acceptance Criteria

The design is complete when all of the following are true:

- A note in an allowed folder can be published from one Obsidian ribbon button.
- The user does not manually run npm or Git commands.
- Only the selected article and its referenced local images enter the public repository.
- A build failure or collision cannot create a Git commit or remote update.
- A valid publication is committed, pushed, and handed to GitHub Actions.
- The same Vault-side configuration works on Windows and macOS with the agreed sibling directory layout.
- Existing AstroOrbitale pages, RSS, tags, and tests continue to pass.
