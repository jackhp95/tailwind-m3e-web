#!/usr/bin/env node
/*
 * bin/generate-component-utilities.mjs
 *
 * Pipeline B — reads @m3e/web's custom-elements.json and emits:
 *   generated/utilities.css   — one Tailwind v4 @utility rule per public
 *                               --m3e-* CSS custom property, sorted
 *                               alphabetically by var name (~2,245 rules).
 *   generated/CSS_CUSTOM_PROPERTIES.md — Markdown reference doc grouped
 *                               by component.
 *
 * Output is deterministic: same manifest → byte-identical files.
 * Pre-built and checked in; re-run only when bumping @m3e/web.
 *
 * Lifted from VOLT-2044 (avetta/ui lemon branch) and adapted for the
 * standalone tailwindcss-m3e package layout.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MANIFEST_PATH = join(ROOT, "node_modules", "@m3e", "web", "dist", "custom-elements.json");
const OUT_UTILITIES = join(ROOT, "generated", "utilities.css");
const OUT_DOC = join(ROOT, "generated", "CSS_CUSTOM_PROPERTIES.md");

// ---------------------------------------------------------------------------
// Type inference: maps the last segment of a CSS var name to a Tailwind v4
// value type and (where applicable) a theme namespace for --value().
// ---------------------------------------------------------------------------

/** @type {Map<string, {type: string, ns: string|null}>} */
const SUFFIX_MAP = new Map([
  ["color", { type: "color", ns: "color" }],
  ["height", { type: "length", ns: "spacing" }],
  ["width", { type: "length", ns: "spacing" }],
  ["size", { type: "length", ns: "spacing" }],
  ["shape", { type: "length", ns: "radius" }],
  ["space", { type: "length", ns: "spacing" }],
  ["spacing", { type: "length", ns: "spacing" }],
  ["padding", { type: "length", ns: "spacing" }],
  ["margin", { type: "length", ns: "spacing" }],
  ["gap", { type: "length", ns: "spacing" }],
  ["inset", { type: "length", ns: "spacing" }],
  ["offset", { type: "length", ns: "spacing" }],
  ["thickness", { type: "length", ns: "spacing" }],
  ["tracking", { type: "length", ns: "tracking" }],
  ["duration", { type: "time", ns: "duration" }],
  ["opacity", { type: "number", ns: "opacity" }],
  ["weight", { type: "number", ns: "font-weight" }],
  ["level", { type: "integer", ns: null }],
]);

/**
 * Infer the Tailwind v4 value type and theme namespace from a CSS var name.
 * Falls back to `{ type: "*", ns: null }` for unknown suffixes.
 *
 * @param {string} varName - e.g. "--m3e-button-container-color"
 * @returns {{ type: string, ns: string|null }}
 */
function inferType(varName) {
  const parts = varName.split("-");
  const suffix = parts[parts.length - 1];
  return SUFFIX_MAP.get(suffix) ?? { type: "*", ns: null };
}

// ---------------------------------------------------------------------------
// extractCssProperties — walk the custom-elements.json manifest and collect
// every public --m3e-* CSS property, deduplicating across components.
// ---------------------------------------------------------------------------

/**
 * @typedef {{ type: string, ns: string|null, description: string }} PropMeta
 */

/**
 * Extract all public --m3e-* CSS custom properties from a CEM manifest.
 *
 * @param {object} manifest - Parsed custom-elements.json
 * @returns {{ flatUnique: Map<string, PropMeta>, byComponent: Map<string, Array<{name: string, description: string}>> }}
 */
export function extractCssProperties(manifest) {
  /** @type {Map<string, PropMeta>} */
  const flatUnique = new Map();
  /** @type {Map<string, Array<{name: string, description: string}>>} */
  const byComponent = new Map();

  for (const mod of manifest.modules ?? []) {
    for (const decl of mod.declarations ?? []) {
      if (!decl.cssProperties || decl.cssProperties.length === 0) continue;
      if (!decl.tagName) continue;

      const props = [];
      for (const prop of decl.cssProperties) {
        const name = prop.name;
        if (!name || !name.startsWith("--m3e-")) continue;

        if (!flatUnique.has(name)) {
          flatUnique.set(name, {
            ...inferType(name),
            description: prop.description ?? "",
          });
        }

        props.push({ name, description: prop.description ?? "" });
      }

      if (props.length > 0) {
        const existing = byComponent.get(decl.tagName) ?? [];
        byComponent.set(decl.tagName, existing.concat(props));
      }
    }
  }

  return { flatUnique, byComponent };
}

// ---------------------------------------------------------------------------
// emitUtilities — render the CSS @utility rules, sorted alphabetically.
// ---------------------------------------------------------------------------

/**
 * Render a single --value() expression from a type and optional namespace.
 *
 * @param {string} type
 * @param {string|null} ns
 * @returns {string}
 */
function valueExpr(type, ns) {
  if (type === "*") return "--value(*)";
  if (ns === null) return `--value(${type})`;
  return `--value(${type}, --${ns}-*)`;
}

/**
 * Emit a deterministic CSS file of @utility rules for every --m3e-* var.
 *
 * @param {Map<string, PropMeta>} flatUnique
 * @returns {string}
 */
export function emitUtilities(flatUnique) {
  const lines = [];

  lines.push("/*");
  lines.push(" * AUTOGENERATED — DO NOT EDIT");
  lines.push(" *");
  lines.push(" * Generated by bin/generate-component-utilities.mjs from");
  lines.push(" * node_modules/@m3e/web/dist/custom-elements.json.");
  lines.push(" *");
  lines.push(" * One Tailwind v4 @utility rule per public --m3e-* CSS custom property,");
  lines.push(" * sorted alphabetically. Re-run `pnpm run generate:utilities` after");
  lines.push(" * bumping @m3e/web.");
  lines.push(" */");
  lines.push("");

  const sorted = [...flatUnique.keys()].sort();
  for (const varName of sorted) {
    const { type, ns } = flatUnique.get(varName);
    const utilName = varName.slice(2); // strip leading "--"
    lines.push(`@utility ${utilName}-* {`);
    lines.push(`  ${varName}: ${valueExpr(type, ns)};`);
    lines.push(`}`);
  }

  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// emitDoc — render a Markdown reference doc grouped by component.
// ---------------------------------------------------------------------------

/**
 * Emit a Markdown reference document grouped by component tag name.
 *
 * @param {Map<string, Array<{name: string, description: string}>>} byComponent
 * @param {Map<string, PropMeta>} flatUnique
 * @returns {string}
 */
export function emitDoc(byComponent, flatUnique) {
  const lines = [];

  lines.push("<!-- AUTOGENERATED — DO NOT EDIT -->");
  lines.push("<!-- Generated by bin/generate-component-utilities.mjs -->");
  lines.push("");
  lines.push("# CSS Custom Properties Reference");
  lines.push("");
  lines.push("One Tailwind v4 `@utility` rule is generated for each property below.");
  lines.push("Usage: `class=\"<property-name-without-dashes>-[<value>]\"`");
  lines.push("");

  const sortedComponents = [...byComponent.keys()].sort();
  for (const tagName of sortedComponents) {
    const props = byComponent.get(tagName);
    lines.push(`## \`${tagName}\``);
    lines.push("");
    lines.push("| Property | Type | Description |");
    lines.push("| --- | --- | --- |");
    for (const { name, description } of props) {
      const meta = flatUnique.get(name);
      const type = meta ? meta.type : "*";
      lines.push(`| \`${name}\` | \`${type}\` | ${description} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// main — read manifest, emit both files.
// ---------------------------------------------------------------------------

export async function main() {
  const raw = await readFile(MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(raw);

  const { flatUnique, byComponent } = extractCssProperties(manifest);

  const css = emitUtilities(flatUnique);
  await mkdir(dirname(OUT_UTILITIES), { recursive: true });
  await writeFile(OUT_UTILITIES, css);
  console.log(`Wrote ${flatUnique.size} @utility rules → ${OUT_UTILITIES}`);

  const doc = emitDoc(byComponent, flatUnique);
  await mkdir(dirname(OUT_DOC), { recursive: true });
  await writeFile(OUT_DOC, doc);
  console.log(`Wrote ${byComponent.size} component sections → ${OUT_DOC}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
