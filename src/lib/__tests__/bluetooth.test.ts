import { describe, expect, it } from "vitest";
import { parseHrValue } from "../bluetooth";

function bytes(...b: number[]): DataView {
  return new DataView(new Uint8Array(b).buffer);
}

describe("parseHrValue", () => {
  it("parses a UINT8 heart rate", () => {
    // flags=0 (UINT8, no RR), bpm=72
    expect(parseHrValue(bytes(0x00, 72))).toEqual({ bpm: 72, rrMs: [] });
  });

  it("parses a UINT16 heart rate (flags bit 0)", () => {
    // flags=0x01, bpm=185 little-endian
    expect(parseHrValue(bytes(0x01, 185, 0x00))).toEqual({ bpm: 185, rrMs: [] });
    expect(parseHrValue(bytes(0x01, 0x70, 0x01))?.bpm).toBe(368); // 0x0170
  });

  it("parses RR intervals in 1/1024 s units", () => {
    // flags=0x08 (RR present, UINT8), bpm=70, RR=1024 (1s) then 512 (0.5s)
    const parsed = parseHrValue(bytes(0x08, 70, 0x00, 0x04, 0x00, 0x02));
    expect(parsed?.bpm).toBe(70);
    expect(parsed?.rrMs).toEqual([1000, 500]);
  });

  it("returns null for too-short payloads", () => {
    expect(parseHrValue(bytes(0x00))).toBeNull();
    expect(parseHrValue(bytes(0x01, 100))).toBeNull(); // UINT16 needs 3 bytes
  });
});
