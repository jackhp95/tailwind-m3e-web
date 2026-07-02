import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { extractCssProperties, emitUtilities, emitDoc } from "../bin/generate-component-utilities.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("generate-component-utilities", () => {
  it("extracts every public --m3e-* var from the manifest", async () => {
    const manifest = JSON.parse(await readFile(join(FIXTURES, "m3e-manifest-mini.json"), "utf8"));
    const { flatUnique, byComponent } = extractCssProperties(manifest);
    expect(flatUnique.size).toBe(8); // 6 button vars + 2 icon vars
    expect(byComponent.size).toBe(2); // m3e-button + m3e-icon
  });

  it("infers types via regex heuristics", async () => {
    const manifest = JSON.parse(await readFile(join(FIXTURES, "m3e-manifest-mini.json"), "utf8"));
    const { flatUnique } = extractCssProperties(manifest);
    expect(flatUnique.get("--m3e-button-container-color")).toMatchObject({ type: "color", ns: "color" });
    expect(flatUnique.get("--m3e-button-shape").type).toBe("length");
    expect(flatUnique.get("--m3e-button-elevation").type).toBe("*");
    expect(flatUnique.get("--m3e-button-duration").type).toBe("time");
    expect(flatUnique.get("--m3e-icon-size").type).toBe("length");
  });

  it("infers color type for state-qualified color vars (regex matches mid-name -color-)", async () => {
    const manifest = JSON.parse(await readFile(join(FIXTURES, "m3e-manifest-mini.json"), "utf8"));
    const { flatUnique } = extractCssProperties(manifest);
    expect(flatUnique.get("--m3e-button-container-color-on-scroll")?.type).toBe("color");
  });

  it("infers number (not color) for *-color-opacity vars — opacity wins over mid-name -color-", () => {
    // Regression for the type-inference ordering bug: names like
    // --m3e-select-disabled-color-opacity contain "-color-" mid-name but are
    // opacities (0–1 numbers), not colours. They must NOT get a --color-* ns.
    const manifest = {
      modules: [
        {
          declarations: [
            {
              kind: "class",
              tagName: "m3e-select",
              cssProperties: [
                {
                  name: "--m3e-select-disabled-color-opacity",
                  description: "The opacity level applied to the disabled text color.",
                },
              ],
            },
          ],
        },
      ],
    };
    const { flatUnique } = extractCssProperties(manifest);
    const entry = flatUnique.get("--m3e-select-disabled-color-opacity");
    expect(entry.type).toBe("number");
    expect(entry.ns).toBeFalsy(); // no theme namespace (undefined/null both mean "none")
  });

  it("emitUtilities output is byte-stable across two runs (snapshot)", async () => {
    const manifest = JSON.parse(await readFile(join(FIXTURES, "m3e-manifest-mini.json"), "utf8"));
    const { flatUnique } = extractCssProperties(manifest);
    const css = emitUtilities(flatUnique);
    expect(css).toMatchSnapshot();
  });

  it("emitDoc output matches snapshot", async () => {
    const manifest = JSON.parse(await readFile(join(FIXTURES, "m3e-manifest-mini.json"), "utf8"));
    const { byComponent, flatUnique } = extractCssProperties(manifest);
    const doc = emitDoc(byComponent, flatUnique);
    expect(doc).toMatchSnapshot();
  });
});
