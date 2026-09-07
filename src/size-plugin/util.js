import { gzipSize } from "gzip-size";
import { sync as brotliSize } from "brotli-size";

/**
 * @param {any} a
 * @return {any}
 */
export const noop = (a) => a;

/**
 * @param {string} input
 */
const noneSize = (input) => Buffer.byteLength(input);

const compressionMethods = {
  brotli: brotliSize,
  gzip: gzipSize,
  none: noneSize,
};

/**
 * @param {'gzip' | 'brotli' | 'none'} method
 * @param {string} content
 * @return {Promise<number>}
 */
export async function compressContent(method, content) {
  return await compressionMethods[method](content);
}
