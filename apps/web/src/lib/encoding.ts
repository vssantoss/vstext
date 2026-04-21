import type { Encoding, LineEnding } from "../types";

export function detectEncoding(buffer: Uint8Array): Encoding {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return "utf-8-bom";
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return "utf-16le";
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return "utf-16be";
  }

  return "utf-8";
}

export function decodeBuffer(buffer: Uint8Array, encoding: Encoding) {
  const normalizedEncoding =
    encoding === "utf-8-bom" ? "utf-8" : encoding === "iso-8859-1" ? "windows-1252" : encoding;
  const offset = encoding === "utf-8-bom" ? 3 : encoding === "utf-16le" || encoding === "utf-16be" ? 2 : 0;
  return new TextDecoder(normalizedEncoding).decode(buffer.slice(offset));
}

export function detectLineEnding(text: string): LineEnding {
  return text.includes("\r\n") ? "crlf" : "lf";
}

export function normalizeLineEndings(text: string, lineEnding: LineEnding) {
  const normalized = text.replace(/\r\n/g, "\n");
  return lineEnding === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

export function isProbablyBinary(buffer: Uint8Array) {
  if (buffer.length === 0) {
    return false;
  }

  let suspicious = 0;

  for (const value of buffer) {
    if (value === 0) {
      return true;
    }

    if (value < 9 || (value > 13 && value < 32)) {
      suspicious += 1;
    }
  }

  return suspicious / buffer.length > 0.1;
}

export function hashText(input: string) {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv:${(hash >>> 0).toString(16)}`;
}
