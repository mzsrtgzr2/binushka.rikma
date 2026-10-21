# Design System v2 Specification

## Design Direction
- Target: close visual quality and structure to `imamerima.com`.
- Brand personality: warm, feminine, professional, calm, trustworthy.
- Principle: readable-first, conversion-oriented, emotionally supportive.

## v2 Token Model

### Color Tokens
- Use semantic tokens, not component-level hardcoded values.

```css
:root {
  --bg: #fcfaf7;
  --surface-1: #ffffff;
  --surface-2: #f4efe8;
  --text-primary: #1f1d1a;
  --text-secondary: #5f5a53;
  --brand-primary: #c88f5a;
  --brand-primary-hover: #b67c46;
  --accent-soft: #e7d6c5;
  --border-soft: #e9dfd3;
  --success: #2f7d4d;
  --danger: #b64646;
}
```

### Typography
- Hebrew-first typography stack:
  - `"Assistant", "Heebo", "Rubik", "Arial", sans-serif`
- Scale:
  - Display: 56/64
  - H1: 44/52
  - H2: 34/42
  - H3: 26/34
  - Body L: 20/32
  - Body M: 18/30
  - Body S: 16/26
  - Label: 14/20

### Spacing Scale
- 4-based spacing system:
  - 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96
- Standard section vertical spacing:
  - Desktop: 96
  - Tablet: 72
  - Mobile: 56

### Radius + Shadow
- Radius tokens:
  - `--radius-sm: 8px`
  - `--radius-md: 12px`
  - `--radius-lg: 18px`
  - `--radius-xl: 24px`
- Shadows:
  - Card default: `0 8px 24px rgba(20, 15, 10, 0.08)`
  - Elevated CTA: `0 12px 30px rgba(20, 15, 10, 0.12)`

## Core Components (v2)

### Header
- Sticky, clean background with soft border.
- Left: logo; center/right: main nav; clear primary CTA optional.
- Mobile: off-canvas panel with strong tap targets and grouped links.

### Footer
- Four-column desktop:
  - Brand/contact
  - Services
  - Shop/resources
  - Legal/newsletter
- Mobile: accordion groups with clear headings.

### Buttons
- Variants:
  - Primary
  - Secondary (surface)
  - Ghost
  - Text link CTA
- Keep interaction states consistent:
  - hover
  - focus-visible
  - disabled

### Cards
- Single shared card base:
  - media area
  - content area
  - optional metadata row
  - optional CTA row
- Modifiers for:
  - workshop card
  - store card
  - testimonial card

### Section Shell
- Shared section primitives:
  - eyebrow label (optional)
  - title
  - description
  - body/grid
  - bottom CTA
- Consistent max-width and line length rules.

## Logo Refresh Direction (Now)

### Concept A: Signature Wordmark
- Handcrafted Hebrew wordmark for `בינושקה`.
- Subline in clean sans: `סדנאות רקמה`.
- Best for emotional boutique feel.

### Concept B: Monogram + Wordmark
- Monogram icon (thread + hoop abstraction) + text lockup.
- Strong for favicon/social/avatar use.
- Better scalability across assets.

### Concept C: Emblem Seal
- Circular seal with needle/thread motif and brand name.
- Strong artisanal perception, useful for packaging and workshop collateral.

### Recommendation
- Primary route: **Concept B (Monogram + Wordmark)**.
- Why:
  - strongest digital flexibility
  - premium but modern
  - easier responsive behavior in header/mobile

## Asset Package To Produce
- `logo-primary.svg`
- `logo-horizontal.svg`
- `logo-icon.svg`
- `logo-light.svg`
- `favicon-32.png`
- `favicon-180.png`

## Accessibility Baseline
- Text contrast minimum WCAG AA.
- Minimum tap target: 44x44 on mobile.
- `:focus-visible` states for nav and controls.
- Body text line length: 55-75 chars equivalent.

## Mapping To Existing Code
- Tokens:
  - `_sass/0-settings/_variables.scss`
  - `_sass/0-settings/_color-scheme.scss`
- Component modules:
  - `_sass/3-modules/_header.scss`
  - `_sass/3-modules/_footer.scss`
  - `_sass/3-modules/_buttons.scss`
  - `_sass/3-modules/_sections.scss`
- Card consolidation:
  - `_sass/3-modules/_projects.scss`
  - `_sass/3-modules/_recommendations.scss`
  - `_sass/4-layouts/_store.scss`
