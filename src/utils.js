import fs from 'fs';
import prettyBytes from 'pretty-bytes';

/**
 * Check if a given file exists and can be accessed.
 * @param {string} filename
 */
export async function fileExists(filename) {
	try {
		await fs.promises.access(filename, fs.constants.F_OK);
		return true;
	} catch (e) {}
	return false;
}

/**
 * Remove any matched hash patterns from a filename string.
 * @param {string=} regex
 * @returns {(((fileName: string) => string) | undefined)}
 */
export function stripHash(regex) {
	if (regex) {
		console.log(`Striping hash from build chunks using '${regex}' pattern.`);
		return function (fileName) {
			return fileName.replace(new RegExp(regex), (str, ...hashes) => {
				hashes = hashes.slice(0, -2).filter((c) => c != null);
				if (hashes.length) {
					for (let i = 0; i < hashes.length; i++) {
						const hash = hashes[i] || '';
						str = str.replace(hash, hash.replace(/./g, '*'));
					}
					return str;
				}
				return '';
			});
		};
	}

	return undefined;
}

/**
 * @param {number} delta
 * @param {number} difference
 */
export function getDeltaText(delta, difference) {
	let deltaText = (delta > 0 ? '+' : '') + prettyBytes(delta);
	if (delta && Math.abs(delta) > 1) {
		deltaText += ` (${Math.abs(difference)}%)`;
	}
	return deltaText;
}

/**
 * @param {number} difference
 */
export function iconForDifference(difference) {
	let icon = '';
	if (difference >= 50) icon = '🆘';
	else if (difference >= 20) icon = '🚨';
	else if (difference >= 10) icon = '⚠️';
	else if (difference >= 5) icon = '🔍';
	else if (difference <= -50) icon = '🏆';
	else if (difference <= -20) icon = '🎉';
	else if (difference <= -10) icon = '👏';
	else if (difference <= -5) icon = '✅';
	return icon;
}

/**
 * @typedef {Object} Diff
 * @property {string} filename
 * @property {number} size
 * @property {number} delta
 */

/**
 * Create a Markdown table showing diff data
 * @param {Diff[]} files
 * @param {object} options
 * @param {boolean} [options.showTotal]
 * @param {boolean} [options.collapseUnchanged]
 * @param {boolean} [options.omitUnchanged]
 * @param {number} [options.minimumChangeThreshold]
 */
export function diffTable(files, { showTotal, collapseUnchanged, omitUnchanged, minimumChangeThreshold }) {
	let out = `| Filename | Size | Change | |\n`;
	out += `|:--- |:---:|:---:|:---:|\n`;

	let outUnchanged = out;

	let totalSize = 0;
	let totalDelta = 0;
	let unchanged = 0;
	let changed = 0;
	for (const file of files) {
		const { filename, size, delta } = file;
		totalSize += size;
		totalDelta += delta;

		const difference = ((delta / size) * 100) | 0;
		let deltaText = getDeltaText(delta, difference);
		let icon = iconForDifference(difference);
		const s = `| \`${filename}\` | ${prettyBytes(size)} | ${deltaText} | ${icon} |\n`;
		const isUnchanged = Math.abs(delta) < minimumChangeThreshold;

		if (isUnchanged && omitUnchanged) continue;

		if (isUnchanged && collapseUnchanged) {
			unchanged++;
			outUnchanged += s;
		} else {
			changed++;
			out += s;
		}
	}

	// no changes, don't show an empty table
	if (!changed) {
		out = '';
	}

	if (unchanged) {
		out += `\n<details><summary>ℹ️ <strong>View Unchanged</strong></summary>\n\n${outUnchanged}\n\n</details>\n\n`;
	}

	if (showTotal) {
		const totalDifference = ((totalDelta / totalSize) * 100) | 0;
		let totalDeltaText = getDeltaText(totalDelta, totalDifference);
		let totalIcon = iconForDifference(totalDifference);
		out = `**Total Size:** ${prettyBytes(totalSize)}\n\n${out}`;
		out = `**Size Change:** ${totalDeltaText} ${totalIcon}\n\n${out}`;
	}

	return out;
}

/**
 * Convert a string "true"/"yes"/"1" argument value to a boolean
 * @param {string} v
 */
export function toBool(v) {
	return /^(1|true|yes)$/.test(v);
}
