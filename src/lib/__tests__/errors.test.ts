import { afterEach, describe, expect, it } from "vitest";
import { captureError, clearLastError, getLastError } from "../errors";

afterEach(() => clearLastError());

describe("error capture", () => {
  it("stores Error objects with a timestamp", () => {
    captureError(new Error("boom"));
    const e = getLastError();
    expect(e?.message).toBe("boom");
    expect(e?.at).toBeTruthy();
  });

  it("coerces non-Error values", () => {
    captureError("plain string failure");
    expect(getLastError()?.message).toBe("plain string failure");
  });

  it("clearLastError empties the store", () => {
    captureError(new Error("x"));
    clearLastError();
    expect(getLastError()).toBeNull();
  });

  it("persists across capture calls (last one wins)", () => {
    captureError(new Error("first"));
    captureError(new Error("second"));
    expect(getLastError()?.message).toBe("second");
  });
});
