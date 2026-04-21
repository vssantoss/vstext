import { describe, expect, it } from "vitest";
import { detectEncoding, detectLineEnding, hashText, isProbablyBinary, normalizeLineEndings } from "./encoding";

describe("encoding helpers", () => {
  it("detects bom-prefixed buffers", () => {
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("utf-8-bom");
    expect(detectEncoding(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toBe("utf-16le");
  });

  it("normalizes line endings", () => {
    expect(detectLineEnding("a\r\nb")).toBe("crlf");
    expect(normalizeLineEndings("a\r\nb", "lf")).toBe("a\nb");
  });

  it("flags binary-like content", () => {
    expect(isProbablyBinary(new Uint8Array([0, 159, 1]))).toBe(true);
    expect(isProbablyBinary(new Uint8Array([65, 66, 67, 10]))).toBe(false);
  });

  it("produces stable text hashes", () => {
    expect(hashText("hello")).toBe(hashText("hello"));
    expect(hashText("hello")).not.toBe(hashText("world"));
  });
});
