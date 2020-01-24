import path from 'path';
import fs from 'fs';
import { getInput, setFailed } from '@actions/core';
import { GitHub, context } from '@actions/github';
import { exec } from '@actions/exec';
import SizePlugin from 'size-plugin-core';
import prettyBytes from 'pretty-bytes';


async function fileExists(filename) {
	try {
		await fs.promises.access(filename, fs.constants.F_OK);
		return true;
	} catch (e) {}
	return false;
}


async function run(octokit, context) {
	const { owner, repo, number: pull_number } = context.issue;

	// console.log('context', context);
	// console.log('payload', context.payload);

	const pr = (await octokit.pulls.get({ owner, repo, pull_number })).data;

	const plugin = new SizePlugin({
		compression: getInput('compression'),
		pattern: getInput('pattern') || '**/dist/*.js',
		exclude: getInput('exclude') || '{**/*.map,**/node_modules/**}'
	});

	console.log(`PR #${pull_number} is targetted at ${context.payload ? context.payload.base.ref : '[error: no payload]'} (or ${pr.base.sha})`);

	const cwd = process.cwd();

	const yarnLock = await fileExists(path.resolve(cwd, 'yarn.lock'));
	const packageLock = await fileExists(path.resolve(cwd, 'package-lock.json'));

	let npm = `npm`;
	let installScript = `npm install`;
	if (yarnLock) {
		console.log('Detected yarn.lock, using Yarn for installation.');
		installScript = npm = `yarn`;
	}
	else if (packageLock) {
		console.log('Detected package-lock.json, using npm ci.');
		installScript = `npm ci`;
	}

	console.log(`Installing using ${npm}`);
	await exec(installScript);
	console.log('computing new sizes');
	await exec(`${npm} run build`);
	const newSizes = await plugin.readFromDisk(cwd);

	let baseRef;
	try {
		baseRef = context.payload.base.ref;
		if (!baseRef) throw Error('missing context.payload.base.ref');
		await exec(`git fetch -n origin ${context.payload.base.ref}`);
		console.log('successfully fetched base.ref');
	} catch (e) {
		console.log('fetching base.ref failed', e.message);
		try {
			await exec(`git fetch -n origin ${pr.base.sha}`);
			console.log('successfully fetched base.sha');
		} catch (e) {
			console.log('fetching base.sha failed', e.message);
			try {
				await exec(`git fetch -n`);
			} catch (e) {
				console.log('fetch failed', e.message);
			}
		}
	}

	console.log('checking out and building base commit');
	try {
		if (!baseRef) throw Error('missing context.payload.base.ref');
		await exec(`git checkout ${baseRef}`);
	}
	catch (e) {
		await exec(`git checkout ${pr.base.sha}`);
	}
	await exec(installScript);
	console.log('computing old sizes');
	await exec(`${npm} run build`);
	const oldSizes = await plugin.readFromDisk(cwd);

	const diff = await plugin.getDiff(oldSizes, newSizes);

	const cliText = await plugin.printSizes(diff);
	console.log('SIZE DIFFERENCES:\n\n' + cliText);

	const markdownDiff = diffTable(diff, {
		collapseUnchanged: toBool(getInput('collapse-unchanged')),
		omitUnchanged: toBool(getInput('omit-unchanged')),
		showTotal: toBool(getInput('show-total'))
	});

	const commentInfo = {
		...context.repo,
		issue_number: pull_number
	};

	const comment = {
		...commentInfo,
		body: markdownDiff + '\n\n<a href="https://github.com/preactjs/compressed-size-action"><sub>compressed-size-action</sub></a>'
	};

	let commentId;
	try {
		const comments = (await octokit.issues.listComments(commentInfo)).data;
		for (let i=comments.length; i--; ) {
			const c = comments[i];
			if (c.user.type === 'Bot' && /<sub>[\s\n]*(compressed|gzip)-size-action/.test(c.body)) {
				commentId = c.id;
				break;
			}
		}
	}
	catch (e) {
		console.log('Error checking for previous comments: ' + e.message);
	}

	if (commentId) {
		try {
			await octokit.issues.updateComment({
				...context.repo,
				comment_id: commentId,
				body: comment.body
			});
		}
		catch (e) {
			console.log('Error editing previous comment: ' + e.message);
			commentId = null;
		}
	}

	// no previous or edit failed
	if (!commentId) {
		await octokit.issues.createComment(comment);
	}

	console.log('All done!');
}

function diffTable(files, { showTotal, collapseUnchanged, omitUnchanged }) {
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

		const difference = (delta / size * 100) | 0;
		let deltaText = getDeltaText(delta, difference);
		let icon = iconForDifference(difference);
		const s = `| \`${filename}\` | ${prettyBytes(size)} | ${deltaText} | ${icon} |\n`;
		const isUnchanged = Math.abs(delta) < 1;

		if (isUnchanged && omitUnchanged) continue;

		if (isUnchanged && collapseUnchanged) {
			unchanged++;
			outUnchanged += s;
		}
		else {
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
		const totalDifference = (totalDelta / totalSize * 100) | 0;
		let totalDeltaText = getDeltaText(totalDelta, totalDifference);
		let totalIcon = iconForDifference(totalDifference);
		out = `**Total Size:** ${prettyBytes(totalSize)}\n\n${out}`;
		out = `**Size Change:** ${totalDeltaText} ${totalIcon}\n\n${out}`;
	}

	return out;
}

function getDeltaText(delta, difference) {
	let deltaText = (delta > 0 ? '+' : '') + prettyBytes(delta);
	if (delta && Math.abs(delta) > 1) {
		deltaText += ` (${Math.abs(difference)}%)`;
	}
	return deltaText;
}

function iconForDifference(difference) {
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

function toBool(v) {
	return /^(1|true|yes)$/.test(v);
}

(async () => {
	try {
		const token = getInput('repo-token', { required: true });
		const octokit = new GitHub(token);
		await run(octokit, context);
	} catch (e) {
		setFailed(e.message);
	}
})();
