# Current Site Audit (binushka.rikma)

## Architecture Snapshot
- Platform: Jekyll with include-driven composition.
- Global shell:
  - `_layouts/default.html`
  - `_includes/head.html`
  - `_includes/header.html`
  - `_includes/footer.html`
- Homepage composition: `index.html` + many `section-*.html` includes.
- Styling system:
  - `_includes/main.scss` as entrypoint
  - tokens in `_sass/0-settings`
  - modules in `_sass/3-modules`

## What Is Already Strong
- Reusable section architecture exists.
- Data-driven menus/content via `_data/settings.yml`.
- Good baseline typography tokenization (`Assistant` font family).
- Responsive grid and breakpoints are defined and reusable.
- The new reviews section is already integrated in a reusable way.

## Current Gaps vs Professional Benchmark

### 1) Visual Consistency Drift
- Multiple sections use one-off spacing and style values.
- Similar card types are implemented separately:
  - projects
  - recommendations
  - store
- Result: design feels assembled instead of unified.

### 2) Inline Styling Debt
- Some templates/includes still carry inline `style` usage and embedded style/script blocks.
- This weakens maintainability and makes coherent redesign harder.

### 3) Section Hierarchy Variability
- Section headers and CTA treatment vary too much by block.
- Visual rhythm between sections is inconsistent.

### 4) Header/Footer Could Work Harder
- Header is functional but can be elevated with stronger branding/interaction polish.
- Footer exists but can better mirror professional utility structure:
  - clearer service grouping
  - trust/legal grouping
  - stronger conversion affordances

### 5) Trust Layering Is Under-Distributed
- Testimonials now exist, but trust proof can be better distributed across page types.
- Service/internal pages need stronger repeated proof patterns.

## Critical Files For Facelift Work
- Layout shell:
  - `_layouts/default.html`
  - `_includes/head.html`
- Navigation/brand framing:
  - `_includes/header.html`
  - `_sass/3-modules/_header.scss`
- Footer utility and trust:
  - `_includes/footer.html`
  - `_sass/3-modules/_footer.scss`
- Section rhythm:
  - `_sass/3-modules/_sections.scss`
- Token foundation:
  - `_sass/0-settings/_variables.scss`
  - `_sass/0-settings/_color-scheme.scss`
- Button and CTA consistency:
  - `_sass/3-modules/_buttons.scss`
- Reusable card consolidation targets:
  - `_sass/3-modules/_projects.scss`
  - `_sass/3-modules/_recommendations.scss`
  - `_sass/4-layouts/_store.scss`

## Priority Debt List
1. Remove inline styles/scripts from content includes where possible.
2. Consolidate card patterns into shared card primitives.
3. Normalize spacing scale across sections and components.
4. Introduce semantic design tokens beyond current color variables.
5. Upgrade header/footer UX parity with premium benchmark.

## Mobile-Specific Findings
- Core breakpoints exist and work.
- Need to improve mobile-first visual hierarchy:
  - clearer top CTA zone
  - tighter spacing rhythm
  - clearer card scannability
- Footer density on mobile can be improved with clearer grouping and spacing.

## Opportunity Summary
- You do not need a full rebuild.
- You need a design-system-level normalization + component polish pass.
- With targeted refactors, the site can achieve a significantly more premium look while keeping current content architecture.
