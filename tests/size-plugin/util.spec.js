import zlib from "node:zlib";

import { noop, compressContent } from "../../src/size-plugin/util.js";

const REPETITIVE = "export const x = 1;\n".repeat(200);
const UNICODE = "héllo wörld — 日本語 🎉";

/** Mirrors the options gzip-size passes to zlib. */
const expectedGzipSize = (input) => zlib.gzipSync(input, { level: 9 }).length;

/** Mirrors the options brotli-size passes to zlib. */
const expectedBrotliSize = (input) => {
  const buffer = Buffer.from(input, "utf8");
  return zlib.brotliCompressSync(buffer, {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_DEFAULT_MODE,
      [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.byteLength,
    },
  }).byteLength;
};

describe("noop", () => {
  test("returns its argument unchanged", () => {
    const obj = { a: 1 };
    expect(noop("index.js")).toBe("index.js");
    expect(noop(obj)).toBe(obj);
    expect(noop(undefined)).toBeUndefined();
  });
});

describe("compressContent", () => {
  test("always resolves to a number", async () => {
    for (const method of /** @type {const} */ (["gzip", "brotli", "none"])) {
      const result = compressContent(method, REPETITIVE);
      expect(result).toBeInstanceOf(Promise);
      const size = await result;
      expect(Number.isInteger(size)).toBe(true);
      expect(size).toBeGreaterThan(0);
    }
  });

  test("`none` returns the UTF-8 byte length, not the string length", async () => {
    expect(await compressContent("none", "abc")).toBe(3);
    expect(await compressContent("none", UNICODE)).toBe(Buffer.byteLength(UNICODE));
    expect(await compressContent("none", UNICODE)).toBeGreaterThan(UNICODE.length);
    expect(await compressContent("none", "")).toBe(0);
  });

  test("`gzip` matches zlib gzip at maximum compression level", async () => {
    expect(await compressContent("gzip", REPETITIVE)).toBe(expectedGzipSize(REPETITIVE));
    expect(await compressContent("gzip", UNICODE)).toBe(expectedGzipSize(UNICODE));
  });

  test("`gzip` returns 0 for empty input", async () => {
    expect(await compressContent("gzip", "")).toBe(0);
  });

  test("`brotli` matches zlib brotli at maximum quality", async () => {
    expect(await compressContent("brotli", REPETITIVE)).toBe(expectedBrotliSize(REPETITIVE));
    expect(await compressContent("brotli", UNICODE)).toBe(expectedBrotliSize(UNICODE));
  });

  test("`brotli` returns the size of an empty brotli stream for empty input", async () => {
    expect(await compressContent("brotli", "")).toBe(expectedBrotliSize(""));
  });

  test("compressing repetitive content shrinks it substantially", async () => {
    const raw = await compressContent("none", REPETITIVE);
    const gzip = await compressContent("gzip", REPETITIVE);
    const brotli = await compressContent("brotli", REPETITIVE);

    expect(gzip).toBeLessThan(raw / 10);
    expect(brotli).toBeLessThan(raw / 10);
  });

  test("gzip and brotli differ from the raw byte length for small input", async () => {
    // Small inputs typically grow because of container overhead; the sizes
    // must still be reported as-is rather than clamped to the raw length.
    const raw = await compressContent("none", "a");
    expect(await compressContent("gzip", "a")).toBeGreaterThan(raw);
    expect(await compressContent("brotli", "a")).toBeGreaterThan(raw);
  });

  test("rejects for an unknown compression method", async () => {
    await expect(
      compressContent(/** @type {any} */ ("zstd"), REPETITIVE),
    ).rejects.toThrow(TypeError);
  });
});
