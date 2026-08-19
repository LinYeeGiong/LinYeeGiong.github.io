# Obsidian One-Click Publishing Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one explicitly selected Obsidian note and its local images to the Astro blog with one button, local verification, Git commit/push, and clear failure recovery.

**Architecture:** A small QuickAdd CommonJS bridge obtains the active Obsidian note and invokes a cross-platform Node CLI in the sibling blog repository. Focused publisher modules inspect content, transform images, and run a guarded Git transaction; Commander exposes the QuickAdd command as a ribbon button and Templater supplies folder-specific drafts.

**Tech Stack:** Node.js >=22.12.0, Astro 7, TypeScript/Vitest, `gray-matter`, `pinyin-pro`, Unified/Remark, Obsidian Templater, QuickAdd, Commander, Git/GitHub Actions.

## Global Constraints

- Keep `LinVault` and `LinYeeGiong.github.io` as sibling directories named exactly that on Windows and macOS.
- Publish only notes under `10_Notes`, `20_Essays`, or `30_Daily`.
- Use `slug` for the copied filename; Daily always uses `YYYY-MM-DD`.
- Generate one stable UUID `publicationId` and reject a changed permanent slug.
- Copy only local images that resolve inside the Vault; never modify source image links.
- Require a clean `origin/main` worktree and successful `npm run verify` before commit.
- Commit only as `LinYeeGiong <linyifeng@stu.xmu.edu.cn>`.
- Never reset, overwrite, or delete unrelated user work.
- Do not push test articles to GitHub.

---

## File Structure

Blog repository files:

```text
scripts/publish-note.mjs              CLI/bootstrap and JSON protocol
scripts/publish/content.mjs           folder mapping, frontmatter, slug and identity
scripts/publish/images.mjs            Markdown/frontmatter image transformation
scripts/publish/git.mjs               guarded Git command adapter
scripts/publish/transaction.mjs       inspect/execute orchestration and rollback
tests/publisher-content.test.ts       content contract tests
tests/publisher-images.test.ts        image transformation tests
tests/publisher-transaction.test.ts   temp-repository transaction tests
src/content.config.ts                 accepts slug/publicationId
package.json                          publisher dependencies and test scripts
package-lock.json                     locked dependency graph
```

Vault files and settings:

```text
Templates/Note.md                     Notes frontmatter template
Templates/Essay.md                    Essays frontmatter template
Templates/Daily.md                    Daily frontmatter template
Scripts/publish-current-note.js       QuickAdd-to-CLI adapter
.obsidian/plugins/templater-obsidian/data.json
.obsidian/plugins/quickadd/data.json
.obsidian/plugins/cmdr/data.json
```

## Task 1: Content Contract And Slugs

**Files:**
- Create: `scripts/publish/content.mjs`
- Create: `tests/publisher-content.test.ts`
- Modify: `src/content.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `class PublishError`, `mapSourceFolder(relativePath)`, `inspectSource({ sourcePath, vaultRoot, blogRoot, randomUUID })`.
- `inspectSource` returns `{ kind, sourcePath, destinationPath, slug, publicationId, metadata, action, publicUrl, existingPath }`.

- [ ] **Step 1: Add publisher dependencies and write failing content tests**

Add `gray-matter`, `pinyin-pro`, `unified`, `remark-parse`, `remark-stringify`, and `unist-util-visit`. Test exact mappings and results:

```ts
expect(mapSourceFolder('10_Notes/cache.md')).toEqual({ kind: 'notes', relative: 'cache.md' });
expect(mapSourceFolder('00_Inbox/private.md')).toBeNull();
expect(resolveSlug({ kind: 'notes', slug: '', fileStem: 'Agent Memory' })).toBe('agent-memory');
expect(resolveSlug({ kind: 'notes', slug: '', fileStem: '智能体记忆' })).toBe('zhi-neng-ti-ji-yi');
expect(resolveSlug({ kind: 'daily', date: '2026-08-19' })).toBe('2026-08-19');
```

Test missing `title`, `description`, and `date`; invalid slug; first-publish UUID; same-ID update; different-ID conflict; and same-ID changed-slug rejection.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run tests/publisher-content.test.ts`  
Expected: FAIL because `scripts/publish/content.mjs` does not exist.

- [ ] **Step 3: Implement the minimal content module**

Use `gray-matter` for YAML, `pinyin-pro` with tone-less lowercase output for Chinese, `crypto.randomUUID()` for identity, and these public error codes:

```js
UNSUPPORTED_FOLDER
INVALID_FRONTMATTER
INVALID_SLUG
SLUG_CONFLICT
PERMALINK_CHANGE
SOURCE_NOT_FOUND
```

Scan only the selected destination collection for a target slug, then scan all three collections for the same `publicationId` before classifying `create` or `update`. Add optional `slug` and `publicationId` strings to `sharedSchema`.

- [ ] **Step 4: Run focused tests and the existing content tests**

Run: `npx vitest run tests/publisher-content.test.ts tests/content.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit the content contract**

```text
git add package.json package-lock.json src/content.config.ts scripts/publish/content.mjs tests/publisher-content.test.ts
git commit -m "feat: add Obsidian publication contract"
```

## Task 2: Safe Image Transformation

**Files:**
- Create: `scripts/publish/images.mjs`
- Create: `tests/publisher-images.test.ts`

**Interfaces:**
- Consumes: `PublishError` from `content.mjs`.
- Produces: `transformArticleImages({ body, metadata, sourcePath, vaultRoot, kind, slug, outputDir })` returning `{ body, metadata, files }` where each file has `{ sourcePath, outputName, publicUrl }`.

- [ ] **Step 1: Write failing image tests with temporary Vault fixtures**

Cover Markdown images, `cover`, Daily `images`, external URLs, missing images, traversal outside the Vault, duplicate basenames, and unsupported `![[wiki.png]]` embeds. Assert an example rewrite:

```ts
expect(result.body).toContain('![diagram](/images/notes/agent-memory/diagram.png)');
expect(result.files[0].sourcePath).toBe(path.join(vault, 'Attachments', 'diagram.png'));
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run tests/publisher-images.test.ts`  
Expected: FAIL because `scripts/publish/images.mjs` does not exist.

- [ ] **Step 3: Implement structured Markdown rewriting**

Parse the body with Unified/Remark, visit `image` nodes, resolve paths relative to the source note, verify `path.relative(vaultRoot, resolved)` does not begin with `..`, and stringify only the public body. Normalize filenames to lowercase ASCII where possible and append the first eight SHA-256 characters when two different files collide.

Use these additional error codes:

```js
IMAGE_NOT_FOUND
IMAGE_OUTSIDE_VAULT
WIKI_IMAGE_UNSUPPORTED
```

- [ ] **Step 4: Run image and content tests**

Run: `npx vitest run tests/publisher-images.test.ts tests/publisher-content.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit image handling**

```text
git add scripts/publish/images.mjs tests/publisher-images.test.ts
git commit -m "feat: publish article images safely"
```

## Task 3: Guarded Publication Transaction And CLI

**Files:**
- Create: `scripts/publish/git.mjs`
- Create: `scripts/publish/transaction.mjs`
- Create: `scripts/publish-note.mjs`
- Create: `tests/publisher-transaction.test.ts`

**Interfaces:**
- Consumes: `inspectSource`, `transformArticleImages`, and `PublishError`.
- Produces: `inspectPublication(options)`, `executePublication(options)`, `runGit(args, options)`, and CLI JSON `{ ok, phase, action, slug, kind, publicUrl, message }`.

- [ ] **Step 1: Write failing transaction tests**

Create a temporary Vault, Git worktree, and local bare remote. Test:

```ts
expect(inspect.action).toBe('create');
expect(result.ok).toBe(true);
expect(await readPublishedFrontmatter()).toMatchObject({ published: true, publicationId: expect.any(String) });
expect(await gitLogSubject()).toBe('content: publish agent-memory');
```

Also test dirty-worktree refusal, update confirmation requirement, verify-command failure rollback, push failure preservation, JSON errors, and no-op updates.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run tests/publisher-transaction.test.ts`  
Expected: FAIL because transaction modules do not exist.

- [ ] **Step 3: Implement Git guards and dependency injection**

`git.mjs` must use `spawn` with argument arrays and `shell: false`; use `git.exe`/`git` and `npm.cmd`/`npm` based on `process.platform`. It validates repository root, branch `main`, upstream `origin/main`, clean status, and remote URL ending in `LinYeeGiong/LinYeeGiong.github.io.git` before `pull --rebase`.

Expose the command runner as an injected dependency so failure paths are deterministic in tests. Hide subprocess windows on Windows.

- [ ] **Step 4: Implement staged writes, backups, verification, commit, and push**

Build the transformed article and image tree in an OS temporary directory. Back up only publisher-owned destination files, update the Vault publication metadata, replace the article-owned output, and run `npm run verify`. Restore exact backups and source bytes when failure occurs before commit. Preserve a successful local commit when push fails and return code `PUSH_PENDING`.

The CLI supports:

```text
node scripts/publish-note.mjs inspect --vault <absolute> --note <vault-relative> --json
node scripts/publish-note.mjs publish --vault <absolute> --note <vault-relative> --confirm-update --json
```

Stdout's final non-empty line is one JSON object. Diagnostics go to stderr.

- [ ] **Step 5: Run transaction tests and complete suite**

Run: `npx vitest run tests/publisher-transaction.test.ts`  
Expected: PASS.  
Run: `npm run verify`  
Expected: PASS.

- [ ] **Step 6: Commit the publication transaction**

```text
git add scripts/publish/git.mjs scripts/publish/transaction.mjs scripts/publish-note.mjs tests/publisher-transaction.test.ts
git commit -m "feat: add guarded one-click publisher"
```

## Task 4: Obsidian Templates And One-Click UI

**Files:**
- Create: `D:/Desktop/PersonalBlog/LinVault/Templates/Note.md`
- Create: `D:/Desktop/PersonalBlog/LinVault/Templates/Essay.md`
- Create: `D:/Desktop/PersonalBlog/LinVault/Templates/Daily.md`
- Create: `D:/Desktop/PersonalBlog/LinVault/Scripts/publish-current-note.js`
- Modify through Obsidian UI: Templater, QuickAdd, and Commander settings.

**Interfaces:**
- Consumes: CLI commands and JSON protocol from Task 3.
- Produces: Obsidian command `QuickAdd: 发布当前文章` and a Commander ribbon button with tooltip `发布当前文章`.

- [ ] **Step 1: Create folder-specific Templater files**

Each template uses `tp.file.title`, `<% tp.date.now("YYYY-MM-DD") %>`, `lang: zh`, `published: false`, and the exact collection-specific fields from the design. Quote title and description values so Chinese punctuation remains valid YAML.

- [ ] **Step 2: Write the QuickAdd bridge**

Export this shape:

```js
module.exports = async ({ app, quickAddApi }) => {
  const active = app.workspace.getActiveFile();
  // inspect -> optional yesNoPrompt -> publish -> Notice
};
```

Resolve `../LinYeeGiong.github.io` from `app.vault.adapter.basePath`, spawn Node with argument arrays, parse the final JSON line, use `quickAddApi.yesNoPrompt` for updates, and use Obsidian `Notice` for progress and results. Never invoke a shell string.

- [ ] **Step 3: Configure Templater with computer-use**

Set template folder to `Templates`, enable folder templates, and map `10_Notes`, `20_Essays`, and `30_Daily` to their matching template files. Refresh Obsidian state and verify all three mappings are visible.

- [ ] **Step 4: Configure QuickAdd with computer-use**

Create one Macro choice named `发布当前文章`, attach `Scripts/publish-current-note.js` as its user script, and enable it as an Obsidian command. Verify it appears in the command palette.

- [ ] **Step 5: Configure Commander with computer-use**

Add a left-ribbon command for `QuickAdd: 发布当前文章`, choose the send icon, and set tooltip/name `发布当前文章`. Refresh app state and verify the ribbon action is present.

- [ ] **Step 6: Run an Obsidian dry inspection**

Open a valid draft fixture in `10_Notes`, invoke the command only through inspection with a temporary blog-root override, and verify Obsidian shows the create plan without pushing. Remove the fixture after the check.

## Task 5: End-To-End Verification And Delivery

**Files:**
- Modify: `README.zh-CN.md` with a concise personal workflow section only if the personal blog README is still theme-oriented.
- Modify: plan checkboxes as tasks complete.

**Interfaces:**
- Consumes all previous tasks.
- Produces a verified local main branch and synchronized remote implementation without test content.

- [ ] **Step 1: Run publisher and site verification**

Run:

```text
npx vitest run tests/publisher-content.test.ts tests/publisher-images.test.ts tests/publisher-transaction.test.ts
npm run verify
git diff --check
```

Expected: all tests pass, Astro check reports zero errors, static build succeeds, and diff check is clean.

- [ ] **Step 2: Perform a local bare-remote smoke test**

Use a temporary sibling Vault/blog pair and local bare remote. Publish one note with one image, assert the remote commit and transformed URL, update it with the same `publicationId`, then assert no file outside that article's paths changed.

- [ ] **Step 3: Inspect final Obsidian and Git state**

Confirm all three plugins are enabled, template mappings are visible, the command and ribbon button exist, the formal repository worktree is clean, and every new commit author is exactly `LinYeeGiong <linyifeng@stu.xmu.edu.cn>`.

- [ ] **Step 4: Push implementation commits**

Run `git pull --rebase origin main`, rerun `npm run verify` if the rebase changed code, then run `git push origin main`. Report the pushed commit IDs and GitHub Actions URL. Do not create a release for this personal-blog workflow.
