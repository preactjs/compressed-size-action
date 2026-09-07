import path from "node:path";
import { promises as fs, globSync } from "node:fs";

import picomatch from "picomatch";
import prettyBytes from "pretty-bytes";

/** @import { PluginOptions } from './index.js'; */
import { noop, compressContent } from "./util.js";

/**
 * @param {object} options
 * @param {'gzip' | 'brotli' | 'none'} [options.compression] compression method to use, default: 'gzip'
 * @param {string} [options.pattern] minimatch pattern of files to track, default: '**\/*.{js,mjs,cjs,jsx,css,html}'
 * @param {string} [options.exclude] minimatch pattern of files NOT to track, default: null
 * @param {(filename: string) => string} [options.stripHash] custom function to remove/normalize hashed filenames for comparison, default: (filename) => filename
 */
export class SizePlugin {
  /** @param {PluginOptions} options */
  constructor(options) {
    options.compression ??= "gzip";
    options.pattern ??= "**/*.{js,mjs,cjs,jsx,css,html}";
    options.exclude ??= null;
    options.stripHash ??= noop;

    this.options = options;
  }

  /**
   * @param {string[]} files
   * @return {string[]}
   */
  filterFiles = (files) => {
    const isMatched = picomatch(this.options.pattern);
    const isExcluded = this.options.exclude
      ? picomatch(this.options.exclude)
      : () => false;
    return files.filter((file) => isMatched(file) && !isExcluded(file));
  };

  /**
   * @param {string} cwd
   * @returns {Promise<Record<string, number>>}
   */
  readFromDisk = async (cwd) => {
    const files = globSync(this.options.pattern, {
      cwd,
      exclude: this.options.exclude ? [this.options.exclude] : undefined,
    });

    /** @type {Record<string, number>} */
    const result = {};
    await Promise.all(
      files.map(async (file) => {
        try {
          const fileContents = await fs.readFile(path.join(cwd, file), "utf-8");
          const size = await compressContent(
            this.options.compression,
            fileContents,
          );
          result[this.options.stripHash(file)] = size;
        } catch {}
      }),
    );

    return result;
  };

  /**
   * @param {Record<string, string>} assets
   * @return {Promise<Record<string, number>>}
   */
  getSizes = async (assets) => {
    const files = this.filterFiles(Object.keys(assets));

    /** @type {Record<string, number>} */
    const result = {};
    await Promise.all(
      files.map(async (file) => {
        try {
          const size = await compressContent(
            this.options.compression,
            assets[file],
          );
          result[this.options.stripHash(file)] = size;
        } catch {}
      }),
    );

    return result;
  };

  /**
   * @param {Record<string, number>} oldSizes
   * @param {Record<string, number>} newSizes
   * @return {{filename: string, size: number, delta: number}[]}
   */
  getDiff = (oldSizes, newSizes) => {
    const filenames = new Set([
      ...Object.keys(oldSizes),
      ...Object.keys(newSizes),
    ]);

    /** @type {{filename: string, size: number, delta: number}[]} */
    const result = [];
    for (const filename of filenames) {
      const size = newSizes[filename] || 0;
      const sizeBefore = oldSizes[filename] || 0;
      const delta = size - sizeBefore;
      result.push({ filename, size, delta });
    }

    return result;
  };

  /**
   * @param {{filename: string, size: number, delta: number}[]} files
   * @return {string}
   */
  printSizes = (files) => {
    const width = Math.max(...files.map((file) => file.filename.length), 0);

    let output = "";

    for (const file of files) {
      const { filename, size, delta } = file;
      const msg = " ".repeat(width - filename.length + 1) + filename + " ⏤ ";

      let sizeText = prettyBytes(size);
      let deltaText = "";

      if (delta && Math.abs(delta) > 1) {
        deltaText = (delta > 0 ? "+" : "") + prettyBytes(delta);
        if (delta > 1024) {
          sizeText = sizeText;
          deltaText = deltaText;
        } else if (delta < -10) {
          deltaText = deltaText;
        }
        sizeText += ` (${deltaText})`;
      }

      output += msg + sizeText + "\n";
    }
    return output;
  };
}
