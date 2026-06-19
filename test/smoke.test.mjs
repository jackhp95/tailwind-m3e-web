import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("test runner is wired", () => {
    expect(1 + 1).toBe(2);
  });
});
