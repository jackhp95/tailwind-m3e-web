import { describe, it, expect } from "vitest";
import { findPrivateVars, verifyAgainstM3e } from "../bin/check-privates.mjs";

describe("check-privates", () => {
  it("findPrivateVars extracts --_* vars from a CSS block", () => {
    const css = `
      @utility m3e-_foo-* { --_foo: --value([color]); }
      @utility m3e-_bar-* { --_bar: --value([length]); }
      @utility m3e-button-* { --m3e-button-x: --value([color]); }  /* public, skipped */
    `;
    expect(findPrivateVars(css)).toEqual(["--_bar", "--_foo"]);
  });

  it("verifyAgainstM3e reports missing privates", () => {
    const declared = ["--_does-not-exist", "--_also-missing"];
    const installedSource = "/* m3e source */ .foo { --_real-private: 1px; }";
    const missing = verifyAgainstM3e(declared, installedSource);
    expect(missing).toEqual(["--_does-not-exist", "--_also-missing"]);
  });

  it("verifyAgainstM3e returns empty when all declared privates exist upstream", () => {
    const declared = ["--_foo"];
    const installedSource = ".x { --_foo: red; }";
    expect(verifyAgainstM3e(declared, installedSource)).toEqual([]);
  });
});
