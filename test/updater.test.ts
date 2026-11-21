import { describe, expect, it } from "vitest";
import { isNewer } from "../src/updater";

describe("isNewer", () => {
  it("compares dotted versions numerically", () => {
    expect(isNewer("0.1.1793000000", "0.1.1792999999")).toBe(true);
    expect(isNewer("0.1.10", "0.1.9")).toBe(true);
    expect(isNewer("0.1.5", "0.1.5")).toBe(false);
    expect(isNewer("0.1.4", "0.1.5")).toBe(false);
    expect(isNewer("0.1.1", "0.0.0")).toBe(true);
  });
});
