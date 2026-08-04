#!/usr/bin/env node
// check-drift.mjs — fail when the committed generated/* + src/ref/_tone-table.css
// no longer match a fresh `gen`.
//
// WHY THIS EXISTS
//   `gen:tones` and `gen:utilities` write git-tracked files (src/ref/_tone-table.css,
//   generated/utilities.css, generated/CSS_CUSTOM_PROPERTIES.md). Nothing used to
//   verify those committed files still matched what the generators produce — the
//   old `prepublishOnly` ran `generate` IN PLACE and then `git diff --exit-code`,
//   which (a) only ran at publish time, so a stale commit could sit on main for
//   weeks before anyone noticed, and (b) mutated the working tree to do the check,
//   which is exactly what a check:* script must never do.
//
//   This is the same drift-gate pattern already shipped in elm-m3e
//   (docs/scripts/check-data-drift.mjs): regenerate into a scratch copy, never in
//   place, and byte-compare against what's committed.
//
// PRECONDITION: the generators must be deterministic. gen:tones derives tone L
// values from a fixed HUES/TONES table (no external input); gen:utilities reads
// the installed @m3e/web manifest (pinned by the lockfile) and writes
// deterministically-ordered output. A generator that embedded a timestamp or an
// absolute path would make this fire spuriously — fix such a generator, don't
// exempt it here.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..");

// The artifacts `gen` writes, relative to the repo root. Kept explicit rather
// than globbed: a glob would silently start (or stop) covering files as the
// tree changes, and this list is the contract.
const ARTIFACTS = ["generated/utilities.css", "generated/CSS_CUSTOM_PROPERTIES.md", "src/ref/_tone-table.css"];

const GEN_STEPS = ["gen:tones", "gen:utilities"];

function fail(msg) {
  console.error(`check:drift: ${msg}`);
  process.exit(1);
}

// Work in a scratch copy so the generators cannot touch the working tree.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tailwind-m3e-web-drift-"));
process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));

try {
  fs.cpSync(REPO, scratch, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(REPO, src);
      if (!rel) return true;
      const top = rel.split(path.sep);
      if (top.includes("node_modules")) return false;
      if (top.includes(".git")) return false;
      if (top.includes("coverage")) return false;
      if (top.includes("dist")) return false;
      return true;
    },
  });

  const nodeModulesTarget = path.join(REPO, "node_modules");
  if (fs.existsSync(nodeModulesTarget)) {
    fs.symlinkSync(nodeModulesTarget, path.join(scratch, "node_modules"), "dir");
  }

  for (const step of GEN_STEPS) {
    try {
      execFileSync("npm", ["run", step], { cwd: scratch, stdio: "pipe" });
    } catch (err) {
      const out = [err.stdout, err.stderr].filter(Boolean).map(String).join("\n");
      fail(`\`${step}\` failed while checking for drift:\n${out}`);
    }
  }
} catch (err) {
  fail(`could not prepare the scratch regen: ${err.message}`);
}

const drifted = ARTIFACTS.filter((rel) => {
  const committed = path.join(REPO, rel);
  const fresh = path.join(scratch, rel);
  if (!fs.existsSync(fresh)) return false; // not produced by these steps
  if (!fs.existsSync(committed)) return true;
  return !fs.readFileSync(committed).equals(fs.readFileSync(fresh));
});

if (drifted.length) {
  console.error("check:drift: FAIL — committed generated artifacts are stale:");
  for (const d of drifted) console.error(`  ${d}`);
  console.error("");
  console.error("Run `pnpm gen` and commit the result.");
  process.exit(1);
}

console.log(`check:drift: OK — ${ARTIFACTS.length} generated artifact(s) match a fresh regen.`);
