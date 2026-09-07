import path from "node:path";

import { SizePlugin } from "../../src/size-plugin/index.js";

import { compressedResultAssertionHelper } from "./utils.js";

test("Should support `compression`", async () => {
  const dataPath = path.resolve(process.cwd(), "tests", "size-plugin", "data");

  const resultGzip = await new SizePlugin({
    compression: "gzip",
  }).readFromDisk(dataPath);

  compressedResultAssertionHelper(resultGzip);

  const resultBrotli = await new SizePlugin({
    compression: "brotli",
  }).readFromDisk(dataPath);

  compressedResultAssertionHelper(resultBrotli);

  const resultNone = await new SizePlugin({
    compression: "none",
  }).readFromDisk(dataPath);

  compressedResultAssertionHelper(resultNone);
});

test("Should support `pattern`", async () => {
  const plugin = new SizePlugin({
    pattern: "**/*.avif",
  });

  const filtered = await plugin.filterFiles([
    "index.mjs",
    "index.js",
    "index.html",
    "style.css",
    "photo.avif",
  ]);

  expect(filtered).toEqual(["photo.avif"]);
});

test("Should support `exclude`", async () => {
  const plugin = new SizePlugin({
    exclude: "**/*.{css,png}",
  });

  const filtered = await plugin.filterFiles([
    "index.mjs",
    "index.js",
    "index.html",
    "style.css",
    "photo.avif",
  ]);

  expect(filtered).toEqual(["index.mjs", "index.js", "index.html"]);
});

test("Should support `stripHash`", async () => {
  const plugin = new SizePlugin({
    stripHash: (filename) => filename.replace(/-(.{8})\.(css|mjs|js)/, ".$2"),
  });

  const sizes = await plugin.getSizes({
    "index-12345678.mjs": "foo",
    "index-12345678.js": "bar",
    "index-12345678.html": "baz",
  });

  expect(Object.keys(sizes).sort()).toEqual([
    "index-12345678.html",
    "index.js",
    "index.mjs",
  ]);
});
