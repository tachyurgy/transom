import { describe, it, expect } from "vitest";
import { callKey, maskNumber } from "../src/log";

describe("log keys", () => {
  it("sort newest first under KV's ascending list order", () => {
    const older = callKey(1_700_000_000_000, "CA1");
    const newer = callKey(1_700_000_001_000, "CA2");
    expect([older, newer].sort()[0]).toBe(newer);
  });
});

describe("maskNumber", () => {
  it("keeps area code and last four of a NANP number", () => {
    expect(maskNumber("+12065550123")).toBe("+1 (206) ***-0123");
  });
  it("masks the middle of anything else", () => {
    expect(maskNumber("+447700900123")).toBe("+44***23");
  });
});
