# Personal About Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a responsive, Chinese-first About page for LinYeeGiong using centralized profile data and the supplied avatar.

**Architecture:** Extend `siteConfig` with one `about` object containing all profile copy and structured lists. Render that object in a single Astro page, keep styling scoped to the page, and store the avatar as a static public asset.

**Tech Stack:** Astro 7, TypeScript, Vitest Astro Container, scoped CSS, GitHub Actions.

## Global Constraints

- Display `LinYeeGiong`, `厦门大学研究生在读`, and `Agents · MLLMs · Computer Vision` exactly.
- Do not invent publications, awards, employers, laboratory affiliations, or project claims.
- Keep personal information centralized in `src/config/site.ts`.
- Keep email hidden while `siteConfig.email` is `null`.
- Preserve Orbitale's existing color tokens, typography, theme switch, and reduced-motion behavior.
- Support viewports down to 320 px without overflow or overlap.

---

### Task 1: About Configuration Contract

**Files:**
- Modify: `src/config/site.ts`
- Modify: `tests/config.test.ts`

**Interfaces:**
- Produces: `siteConfig.about` with `eyebrow`, `title`, `description`, `avatar`, `status`, `identity`, `intro`, `facts`, `focuses`, `stack`, `principles`, `timeline`, `beyond`, and `contactPrompt`.

- [ ] **Step 1: Write the failing configuration assertions**

Assert the exact identity, three research focus labels, required stack values, avatar path, and null-email behavior.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL because `siteConfig.about` does not exist.

- [ ] **Step 3: Add the complete About configuration**

Add all approved Chinese copy and structured lists under `siteConfig.about` without changing existing homepage configuration.

- [ ] **Step 4: Run the focused test**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS.

### Task 2: About Page And Avatar

**Files:**
- Create: `public/images/profile/lin-avatar.jpg`
- Replace: `src/pages/about.astro`
- Create: `tests/about.test.ts`

**Interfaces:**
- Consumes: `siteConfig.about`, `siteConfig.github`, and `siteConfig.email`.
- Produces: semantic `/about/` HTML containing the profile hero, focus list, stack matrix, principles, timeline, beyond statement, and contact links.

- [ ] **Step 1: Write the failing rendered-page test**

Render `AboutPage` with `AstroContainer` and assert the avatar alt text, `LinYeeGiong`, `厦门大学研究生在读`, all three focus labels, `data-about-profile`, `data-focus-item`, GitHub link, and RSS link.

- [ ] **Step 2: Run the page test and confirm failure**

Run: `npx vitest run tests/about.test.ts`
Expected: FAIL because the placeholder page lacks the approved structure.

- [ ] **Step 3: Add the supplied avatar asset**

Copy `D:/Desktop/头像.jpg` to `public/images/profile/lin-avatar.jpg` without modifying the source file.

- [ ] **Step 4: Implement the semantic page**

Render config-driven sections with a square avatar frame, compact facts, research rows, grouped stack, principles, timeline, and contact footer. Use scoped responsive CSS with 8 px-or-less radii and existing design tokens.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/about.test.ts tests/config.test.ts`
Expected: PASS.

### Task 3: Visual And Release Verification

**Files:**
- Modify only if verification reveals a scoped About-page defect.

**Interfaces:**
- Consumes: built About page.
- Produces: a verified `main` branch pushed to GitHub.

- [ ] **Step 1: Run repository verification**

Run: `npm run verify` and `git diff --check`.
Expected: all tests pass, Astro check has zero errors, and the static build succeeds.

- [ ] **Step 2: Inspect desktop and mobile layouts**

Start the Astro dev server and inspect `/about/` at approximately 1440x900 and 390x844. Confirm the image renders, all text fits, and hover/focus interactions do not shift layout.

- [ ] **Step 3: Commit with the required identity**

Commit as `LinYeeGiong <linyifeng@stu.xmu.edu.cn>` with subject `feat: build personal about page`.

- [ ] **Step 4: Merge, reverify, and push**

Fast-forward the feature branch into `main`, rerun `npm run verify`, pull with rebase if needed, and push `main` to `origin`.

