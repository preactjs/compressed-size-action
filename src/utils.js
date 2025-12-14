import fs from 'fs';
import path from 'path';
import prettyBytes from 'pretty-bytes';

/**
 * @param {string} cwd
 * @returns {Promise<{ packageManager: string, installScript: string }>}
 */
export async function getPackageManagerAndInstallScript(cwd) {
	const [yarnLockExists, pnpmLockExists, bunLockBinaryExists, bunLockExists, packageLockExists] = await Promise.all([
		fileExists(path.resolve(cwd, 'yarn.lock')),
		fileExists(path.resolve(cwd, 'pnpm-lock.yaml')),
		fileExists(path.resolve(cwd, 'bun.lockb')),
		fileExists(path.resolve(cwd, 'bun.lock')),
		fileExists(path.resolve(cwd, 'package-lock.json')),
	]);

	let packageManager = 'npm';
	let installScript = 'npm install';
	if (yarnLockExists) {
		installScript = 'yarn --frozen-lockfile';
		packageManager = 'yarn';
	} else if (pnpmLockExists) {
		installScript = 'pnpm install --frozen-lockfile';
		packageManager = 'pnpm';
	} else if (bunLockBinaryExists || bunLockExists) {
		installScript = 'bun install --frozen-lockfile';
		packageManager = 'bun';
	} else if (packageLockExists) {
		installScript = 'npm ci';
	}

	return { packageManager, installScript };
}

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
		console.log(`Stripping hash from build chunks using '${regex}' pattern.`);
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
 * @param {number} originalSize
 */
export function getDeltaText(delta, originalSize) {
	let deltaText = (delta > 0 ? '+' : '') + prettyBytes(delta);
	if (Math.abs(delta) === 0) {
		// only print size
	} else if (originalSize === 0) {
		deltaText += ` (new file)`;
	} else if (originalSize === -delta) {
		deltaText += ` (removed)`;
	} else {
		const percentage = Number(((delta / originalSize) * 100).toFixed(2));
		deltaText += ` (${percentage > 0 ? '+' : ''}${percentage}%)`;
	}
	return deltaText;
}

/**
 * @param {number} delta
 * @param {number} originalSize
 */
export function iconForDifference(delta, originalSize) {
	if (originalSize === 0) return '🆕';

	const percentage = Math.round((delta / originalSize) * 100);
	if (percentage >= 50) return '🆘';
	else if (percentage >= 20) return '🚨';
	else if (percentage >= 10) return '⚠️';
	else if (percentage >= 5) return '🔍';
	else if (percentage <= -50) return '🏆';
	else if (percentage <= -20) return '🎉';
	else if (percentage <= -10) return '👏';
	else if (percentage <= -5) return '✅';
	return '';
}

/**
 * Create a Markdown table from text rows
 * @param {string[][]} rows
 */
function markdownTable(rows) {
	if (rows.length == 0) {
		return '';
	}

	// Skip all empty columns
	while (rows.every(columns => !columns[columns.length - 1])) {
		for (const columns of rows) {
			columns.pop();
		}
	}

	const [firstRow] = rows;
	let columnLength = firstRow.length;

	// Hide `Change` column if they are all `0 B`
	if (columnLength === 3 && rows.every(columns => columns[2] === '0 B')) {
		columnLength -= 1;
		for (const columns of rows) {
			columns.pop();
		}
	}

	if (columnLength === 0) {
		return '';
	}

	return [
		// Header
		['Filename', 'Size', 'Change', ''].slice(0, columnLength),
		// Align
		[':---', ':---:', ':---:', ':---:'].slice(0, columnLength),
		// Body
		...rows
	].map(columns => `| ${columns.join(' | ')} |`).join('\n');
}

/**
 * @typedef {Object} Diff
 * @property {string} filename
 * @property {number} size
 * @property {number} delta
 */

/**
 * @typedef {'Filename' | 'Size' | 'Change'} DiffTableColumn
 * @typedef {'asc' | 'desc'} SortOrder
 * @typedef {`${DiffTableColumn}:${SortOrder}`} SortBy
 */

/**
 * Create a Markdown table showing diff data
 * @param {Diff[]} files
 * @param {object} options
 * @param {boolean} [options.showTotal]
 * @param {boolean} [options.collapseUnchanged]
 * @param {boolean} [options.omitUnchanged]
 * @param {number} [options.minimumChangeThreshold]
 * @param {SortBy} [options.sortBy]
 * @returns {string}
 */
export function diffTable(files, { showTotal, collapseUnchanged, omitUnchanged, minimumChangeThreshold, sortBy }) {
	const changedRows = [],
		unChangedRows = [];

	const [sortByColumn, sortByDirection] = /** @type {[DiffTableColumn, SortOrder]} */ (sortBy.split(':'));

	const columnIndex = {
		Filename: 'filename',
		Size: 'size',
		Change: 'delta'
	};

	files.sort((a, b) => {
		const idx = columnIndex[sortByColumn];
		return sortByDirection === 'asc'
			? a[idx].toString().localeCompare(b[idx].toString(), undefined, { numeric: true })
			: b[idx].toString().localeCompare(a[idx].toString(), undefined, { numeric: true });
	});

	let totalSize = 0;
	let totalDelta = 0;
	for (const file of files) {
		const { filename, size, delta } = file;
		totalSize += size;
		totalDelta += delta;

		const originalSize = size - delta;
		const isUnchanged = Math.abs(delta) < minimumChangeThreshold;
		console.log('minimumChangeThreshold:', minimumChangeThreshold);
		console.log({ filename, size, delta, originalSize, isUnchanged });

		if (isUnchanged && omitUnchanged) continue;

		const row = [
			`\`${filename}\``,
			prettyBytes(size),
			getDeltaText(delta, originalSize),
			iconForDifference(delta, originalSize)
		];
		if (isUnchanged && collapseUnchanged) {
			unChangedRows.push(row);
		} else {
			changedRows.push(row);
		}
	}

	let out = markdownTable(changedRows);

	if (unChangedRows.length !== 0) {
		const outUnchanged = markdownTable(unChangedRows);
		out += `\n\n<details><summary>ℹ️ <strong>View Unchanged</strong></summary>\n\n${outUnchanged}\n\n</details>\n\n`;
	}

	if (showTotal) {
		const totalOriginalSize = totalSize - totalDelta;
		let totalDeltaText = getDeltaText(totalDelta, totalOriginalSize);
		let totalIcon = iconForDifference(totalDelta, totalOriginalSize);
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

/**
 * @param {string} sortBy
 * @returns {SortBy}
 */
export function getSortOrder(sortBy) {
	const validColumns = ['Filename', 'Size', 'Change'];
	const validDirections = ['asc', 'desc'];

	const [column, direction] = sortBy.split(':');
	if (validColumns.includes(column) && validDirections.includes(direction)) {
		return /** @type {SortBy} */ (sortBy);
	}
	console.warn(`Invalid 'order-by' value '${sortBy}', defaulting to 'Filename:asc'`);
	return 'Filename:asc';
}
