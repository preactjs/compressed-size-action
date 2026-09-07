/**
 * Compression sizes are non-deterministic across platforms and Node versions,
 * best we can do is check for keys & that the values are numbers > 0
 *
 * @param {Record<string, number>} result
 */
export function compressedResultAssertionHelper(result) {
  expect(Object.keys(result).sort()).toEqual([
    "index.cjs",
    "index.html",
    "index.js",
    "index.mjs",
  ]);

  for (const key in result) {
    expect(typeof result[key]).toEqual("number");
    expect(result[key] > 0).toBe(true);
  }
}
