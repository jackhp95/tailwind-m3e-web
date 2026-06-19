# tailwindcss-m3e

[![CI](https://github.com/<owner>/tailwindcss-m3e/actions/workflows/ci.yml/badge.svg)](https://github.com/<owner>/tailwindcss-m3e/actions/workflows/ci.yml)

Tailwind v4 plugin exposing **Material 3 Expressive** design tokens and **every [@m3e/web](https://github.com/matraic/m3e) component CSS variable** as Tailwind utilities.

- 🎨 Four-layer override cascade (seed → ref palette → sys role → @theme key) — override at the layer matching your intent.
- 🧮 OKLCH-derived tonal palettes calibrated against [Material Color Utilities](https://github.com/material-foundation/material-color-utilities). Change one seed colour, watch the whole app retint.
- 🧩 ~2,245 auto-generated `@utility` rules covering every public `--m3e-*` CSS variable in `@m3e/web`.
- 🪶 Tailwind v4 only emits the rules you actually use — net bundle cost ≈ 0.

## Install

```bash
pnpm add tailwindcss-m3e
# Optional: install @m3e/web if you want the component-utility surface
pnpm add @m3e/web
```

Requires Tailwind v4. Requires Chrome 119+ / Safari 16.4+ / Firefox 128+ (gated on `oklch(from …)`).

## Use

```css
/* app.css */
@import "tailwindcss";

@import "tailwindcss-m3e";                  /* M3 tokens (Layers 0–3) */
@import "tailwindcss-m3e/utilities";        /* @m3e/web component setters */
@import "tailwindcss-m3e/roles-extended";   /* optional: success / info / warning */
```

Now you can use utilities like:

```html
<button class="bg-primary text-on-primary rounded-md-corner-medium shadow-md-level1">
  Themed button
</button>

<m3e-button class="m3e-button-container-color-primary">
  Themed @m3e/web button
</m3e-button>
```

## Override

The plugin exposes four cascading layers. Override at whichever matches your intent:

```css
/* Layer 0 — rebrand the whole app with one var. */
:root { --md-seed-primary: #06765b; }

/* Layer 1 — replace a single tonal palette while keeping others derived. */
:root {
  --md-ref-palette-secondary-40: #abcdef;
  /* (… all 12 tones) */
}

/* Layer 2 — change how a role maps to tones. */
:root { --md-sys-color-primary: var(--md-ref-palette-primary-30); }

/* Layer 3 — override one Tailwind utility's value. */
@theme { --color-primary: tomato; }
```

Scoped overrides work too — any descendant of a styled element picks up the new seed:

```html
<div style="--md-seed-primary: #b00020;">
  <!-- everything inside computes from red -->
</div>
```

## How it works

```
Layer 0  SEED              --md-seed-primary, --md-seed-error
       │
Layer 1  REF PALETTE       --md-ref-palette-<palette>-<tone>
       │                   computed via oklch(from var(--md-seed-*) <L> <c-transform> <h-transform>)
       │
Layer 2  SYS ROLES         --md-sys-color-*, --md-sys-typescale-*, …
       │                   uses light-dark() for scheme-aware values
       │                   @m3e/web reads these directly from shadow DOM
       │
Layer 3  @theme            --color-primary, --text-body-lg, --radius-md-corner-medium, …
                           Tailwind v4 generates utilities
```

The tone-to-OKLCH-L mapping is calibrated offline against `@material/material-color-utilities` and shipped as a small CSS table — no MCU dep at consumer install.

## API surface

| Entry point | Surface |
|---|---|
| `tailwindcss-m3e` | Strict M3 spec — primary/secondary/tertiary/error/surface/outline/inverse/background roles + 6 spec tonal palettes. |
| `tailwindcss-m3e/utilities` | Pre-built `@utility` rules for every public `--m3e-*` var in the pinned `@m3e/web` peerDep range. |
| `tailwindcss-m3e/roles-extended` | Opt-in success/info/warning roles + tonal namespaces. |

Internal CSS files (`./seed.css`, `./ref/*`, `./sys/*`, `./theme.css`) are not reachable via `@import`; the `exports` map prevents direct access.

## Versioning

Peer-dep range: `"@m3e/web": "^2.5.0 <3"`. Plugin minors track `@m3e/web` minors (new component vars regen the utilities). Plugin majors track `@m3e/web` breaking changes OR breaking `@theme` rename/remove.

## License

MIT. Material Design 3 specifications and the `@m3e/web` library are independent works by their respective owners; this plugin is not affiliated with or endorsed by Google or `matraic`.
