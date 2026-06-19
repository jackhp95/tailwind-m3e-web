import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

describe("sys layer files", () => {
  for (const layer of ["color", "typescale", "motion", "shape", "elevation", "state", "density"]) {
    it(`${layer}.css contains at least one --md-sys-${layer === "color" ? "color" : layer}- var`, async () => {
      const css = await readFile(join(SRC, "sys", `${layer}.css`), "utf8");
      const expected = layer === "color" ? "--md-sys-color-" : `--md-sys-${layer}-`;
      expect(css).toContain(expected);
    });
  }

  it("no file references Avetta selectors", async () => {
    for (const layer of ["color", "typescale", "motion", "shape", "elevation", "state", "density"]) {
      const css = await readFile(join(SRC, "sys", `${layer}.css`), "utf8");
      expect(css).not.toMatch(/avt-|avetta|data-avt|theme-[a-z]/i);
    }
  });
});
