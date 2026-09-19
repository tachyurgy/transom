import { describe, it, expect } from "vitest";
import { maskNumber } from "../src/log";

describe("maskNumber", () => {
  it("keeps area code and last four of a NANP number", () => {
    expect(maskNumber("+12065550123")).toBe("+1 (206) ***-0123");
  });
  it("masks the middle of anything else", () => {
    expect(maskNumber("+447700900123")).toBe("+44***23");
  });
});
