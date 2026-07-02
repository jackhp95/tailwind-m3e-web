#!/usr/bin/env node
/*
 * bin/generate-component-utilities.mjs
 *
 * Reads node_modules/@m3e/web/dist/custom-elements.json and emits:
 *
 *   1. generated/utilities.css
 *      One @utility rule per public --m3e-* CSS custom property.
 *      Each rule uses Tailwind v4's --value(<type>, --<namespace>-*)
 *      syntax so call sites can pass either an arbitrary value or a
 *      theme key. Inert under Tailwind v3.
 *
 *   2. generated/CSS_CUSTOM_PROPERTIES.md
 *      Structured reference, grouped by component, with type + description.
 *
 * Type inference is suffix-driven, with a small hand-corrected override
 * map for ambiguous names. See `inferType()` and `OVERRIDES` below.
 *
 * Determinism: re-running this script on the same manifest produces
 * byte-identical output. Use `git diff` to verify after running.
 *
 * Ported from VOLT-2044 (avetta/ui lemon branch) and adapted for the
 * standalone tailwind-m3e-web package layout.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MANIFEST_PATH = join(ROOT, "node_modules", "@m3e", "web", "dist", "custom-elements.json");
const OUT_UTILITIES = join(ROOT, "generated", "utilities.css");
const OUT_DOC = join(ROOT, "generated", "CSS_CUSTOM_PROPERTIES.md");

/* ──────────────────────────────────────────────────────────────────
   Type inference

   Each entry: [matcher, type, themeNamespace?]
     - matcher: (name, description) => boolean
     - type: Tailwind v4 --value() type token (e.g. "color", "length")
     - themeNamespace: optional --theme-key prefix that lets call sites
       pass theme keys (e.g. m3e-foo-color-primary → --color-primary)

   First match wins. Order matters — put more specific patterns first.
   ────────────────────────────────────────────────────────────────── */

/* Patterns match "type token followed by - or end". This catches state-
   suffix variants like --foo-color-on-scroll (color with state qualifier
   at end) AND prefixed variants like --foo-hover-container-color. */

const RULES = [
  // Opacity & numeric scalars — checked BEFORE color so names like
  // `*-color-opacity` (which contain `-color-` mid-name but are 0–1 numbers,
  // e.g. --m3e-select-disabled-color-opacity) infer `number`, not `color`.
  [(n) => /-opacity(-|$)/.test(n), "number"],
  [(n) => /-z-index(-|$)/.test(n), "number"],

  // Colors. NOTE: `*-elevation-color` vars intentionally still match here
  // (they are shadow-tint colours), since the elevation rule below is not
  // hoisted above this one.
  [(n) => /-color(-|$)/.test(n), "color", "color"],

  // Radii / shape
  [(n) => /-shape(-|$)/.test(n), "length", "radius"],
  [(n) => /-corner-/.test(n), "length", "radius"],

  // Typography
  [(n) => /-(font-size|text-size)(-|$)/.test(n), "length", "text"],
  [(n) => /-line-height(-|$)/.test(n), "length", "leading"],
  [(n) => /-(tracking|letter-spacing)(-|$)/.test(n), "length", "tracking"],
  [(n) => /-font-weight(-|$)/.test(n), "number", "font-weight"],
  [(n) => /-(font-family|font)(-|$)/.test(n), "*", "font"],

  // Motion
  [(n) => /-duration(-|$)/.test(n), "time", "transition-duration"],
  [(n) => /-easing(-|$)/.test(n), "*", "ease"],
  [(n) => /-transition(-|$)/.test(n), "*"],
  [(n) => /-transform(-|$)/.test(n), "*"],

  // Elevation
  [(n) => /-elevation(-|$)/.test(n), "*", "shadow"],

  // Lengths (catch-all for spatial dims). Component-local — no namespace.
  [
    (n) =>
      /-(size|height|width|spacing|space|offset|thickness|gap|inset|outset|reserved|peek-height|top-space|bottom-space|start-space|end-space)(-|$)/.test(
        n,
      ),
    "length",
  ],
  [(n) => /-(padding|margin)(-[a-z]+)?(-|$)/.test(n), "length"],
  [(n) => /-(min|max)-(width|height|size|inline-size|block-size)(-|$)/.test(n), "length"],
  [(n) => /-(left|right|top|bottom)(-|$)/.test(n), "length"],
];

/* Hand-corrected overrides for ambiguous or non-suffix-fitting names.
   Keyed by full var name; value is [type, themeNamespace?]. */

const OVERRIDES = {
  // The following vars look like colors by suffix but aren't:
  // (none observed yet — extend as needed)
};

function inferType(name, description = "") {
  if (OVERRIDES[name]) return OVERRIDES[name];
  for (const [matcher, type, ns] of RULES) {
    if (matcher(name, description)) return [type, ns];
  }
  // Fallback — accept any value, no theme namespace.
  return ["*", null];
}

/* ──────────────────────────────────────────────────────────────────
   Manifest loading
   ────────────────────────────────────────────────────────────────── */

async function loadManifest() {
  const raw = await readFile(MANIFEST_PATH, "utf8");
  return JSON.parse(raw);
}

/* Returns { byComponent: Map<tagName, {description, vars: [{name, description, type, ns}]}>,
             flatUnique: Map<name, {description, type, ns, components: [tagName]}> } */
export function extractCssProperties(manifest) {
  const byComponent = new Map();
  const flatUnique = new Map();

  for (const mod of manifest.modules || []) {
    for (const decl of mod.declarations || []) {
      if (decl.kind !== "class" || !decl.cssProperties?.length) continue;
      const tag = decl.tagName || decl.name;
      const compEntry = { description: decl.description || "", vars: [] };
      for (const prop of decl.cssProperties) {
        const [type, ns] = inferType(prop.name, prop.description);
        const entry = {
          name: prop.name,
          description: prop.description || "",
          type,
          ns,
        };
        compEntry.vars.push(entry);

        const existing = flatUnique.get(prop.name);
        if (existing) {
          if (!existing.components.includes(tag)) existing.components.push(tag);
          // Keep the first description we saw (they're usually identical).
        } else {
          flatUnique.set(prop.name, { ...entry, components: [tag] });
        }
      }
      // Skip components with no public vars (some have only inherited).
      if (compEntry.vars.length) {
        const prev = byComponent.get(tag);
        if (prev) {
          // Merge — some elements have declarations split across modules.
          for (const v of compEntry.vars) {
            if (!prev.vars.find((x) => x.name === v.name)) prev.vars.push(v);
          }
        } else {
          byComponent.set(tag, compEntry);
        }
      }
    }
  }

  return { byComponent, flatUnique };
}

/* ──────────────────────────────────────────────────────────────────
   Emit utilities.css
   ────────────────────────────────────────────────────────────────── */

function buildUtilityRule(entry) {
  // Utility class is the var name without the leading "--".
  // E.g. --m3e-button-container-color → @utility m3e-button-container-color-*
  const cls = entry.name.replace(/^--/, "");
  const valueExpr = entry.ns
    ? `--value([${entry.type}], --${entry.ns}-*)`
    : `--value([${entry.type}])`;
  return `@utility ${cls}-* {\n  ${entry.name}: ${valueExpr};\n}`;
}

export function emitUtilities(flatUnique) {
  const names = [...flatUnique.keys()].sort();
  const header = `/*
 * AUTO-GENERATED — DO NOT EDIT
 *
 * Generated by bin/generate-component-utilities.mjs from
 * node_modules/@m3e/web/dist/custom-elements.json.
 *
 * One @utility rule per public --m3e-* CSS custom property in the
 * m3e manifest (${names.length} rules). Each rule lets call sites pass
 * either an arbitrary value or a Tailwind v4 theme key.
 *
 * INERT UNTIL TAILWIND v4. @utility is unrecognized syntax in v3;
 * the v3 build and prettier silently ignore the entire file.
 */
`;
  const body = names.map((n) => buildUtilityRule(flatUnique.get(n))).join("\n\n");
  return `${header}\n${body}\n`;
}

/* ──────────────────────────────────────────────────────────────────
   Emit CSS_CUSTOM_PROPERTIES.md
   ────────────────────────────────────────────────────────────────── */

export function emitDoc(byComponent, flatUnique) {
  const lines = [];
  lines.push("<!-- AUTO-GENERATED — DO NOT EDIT. Regenerate via:");
  lines.push("     node bin/generate-component-utilities.mjs -->");
  lines.push("");
  lines.push("# M3e CSS Custom Properties");
  lines.push("");
  lines.push(
    "Structured reference for every public CSS custom property exposed by m3e web components, grouped by component, with inferred Tailwind v4 type and (where applicable) the theme namespace used by the matching `@utility` setter class.",
  );
  lines.push("");
  lines.push(
    `Total: **${flatUnique.size} unique** public vars across **${byComponent.size} components**.`,
  );
  lines.push("");

  // Table of contents
  lines.push("## Components");
  lines.push("");
  const tags = [...byComponent.keys()].sort();
  for (const tag of tags) {
    lines.push(`- [\`${tag}\`](#${tag.replace(/[^a-z0-9]/g, "-")})`);
  }
  lines.push("");

  // Per-component sections
  for (const tag of tags) {
    const { description, vars } = byComponent.get(tag);
    lines.push(`## \`${tag}\``);
    lines.push("");
    if (description) {
      lines.push(description);
      lines.push("");
    }
    lines.push("| Var | Type | Theme namespace | Description |");
    lines.push("|---|---|---|---|");
    for (const v of vars.sort((a, b) => a.name.localeCompare(b.name))) {
      const ns = v.ns ? `\`--${v.ns}-*\`` : "—";
      const desc = (v.description || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(`| \`${v.name}\` | \`${v.type}\` | ${ns} | ${desc} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/* ──────────────────────────────────────────────────────────────────
   Main
   ────────────────────────────────────────────────────────────────── */

async function main() {
  const manifest = await loadManifest();
  const { byComponent, flatUnique } = extractCssProperties(manifest);

  await mkdir(dirname(OUT_UTILITIES), { recursive: true });
  await writeFile(OUT_UTILITIES, emitUtilities(flatUnique));
  await writeFile(OUT_DOC, emitDoc(byComponent, flatUnique));

  console.log(`Wrote ${flatUnique.size} @utility rules → ${OUT_UTILITIES}`);
  console.log(`Wrote ${byComponent.size} component sections → ${OUT_DOC}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
