# Personal About Page Design

## Goal

Replace the placeholder About page with a Chinese-first personal profile for LinYeeGiong that balances graduate research identity, engineering practice, public writing, and personality.

## Public Identity

- Display name: `LinYeeGiong`
- Identity: 厦门大学研究生在读
- Research focus: `Agents · MLLMs · Computer Vision`
- Public contact: GitHub and RSS; email remains hidden while `siteConfig.email` is `null`
- Avatar source: desktop file `头像.jpg` (the available file corresponding to the requested avatar)

## Information Architecture

1. A profile-led hero with avatar, status indicator, name, identity, research statement, and compact metadata.
2. Three research-focus entries for Agent Systems, MLLMs, and Computer Vision.
3. A grouped technology matrix covering Python, TypeScript, FastAPI, Pydantic, PostgreSQL, Next.js, Docker, GitHub Actions, Obsidian, and Astro.
4. Four working principles: build to understand, write to clarify, prefer systems over demos, and keep unfinished thoughts.
5. A truthful `NOW / BUILDING / NEXT` timeline without invented awards, publications, labs, or employers.
6. A short technology-beyond-life statement and GitHub/RSS contact links.

## Visual Direction

The page extends Orbitale's restrained laboratory-archive language: serif display copy, mono labels, thin rules, coral/cyan/green/yellow accents, and full-width content bands. The avatar is a square editorial image with a precise frame, not a circular social-media portrait. Hover and focus states use small translations, line reveals, and color changes, with reduced-motion support inherited from global CSS.

Desktop uses a profile rail beside the narrative content. Mobile collapses to one column, keeps all copy readable at 320 px, and turns dense metadata and technology groups into stable stacked rows.

## Configuration Boundary

All personal copy and repeated profile data live under `siteConfig.about`. `src/pages/about.astro` only renders that data. This preserves the project's single customization entry and keeps the page reusable.

## Accessibility And SEO

- Avatar has meaningful alternative text.
- Research sections and navigation use semantic headings and landmarks.
- Links and interactive focus rows have keyboard-visible focus states.
- Page title and description come from the centralized About configuration.
- Decorative marks remain hidden from assistive technology.

## Verification

- A configuration test locks the public identity, research focuses, stack, and hidden-email behavior.
- An Astro container test verifies semantic sections, avatar alt text, key copy, and public links.
- Full `npm run verify` must pass.
- Desktop and mobile browser screenshots must show no overlaps, clipping, blank image, or incoherent responsive layout.

