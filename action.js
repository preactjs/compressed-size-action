import { getInput, setFailed } from '@actions/core';
import { GitHub, context } from '@actions/github';
import { exec } from '@actions/exec';
import SizePlugin from 'size-plugin-core';
import prettyBytes from 'pretty-bytes';


async function run(octokit, context) {
	const { owner, repo, number: pull_number } = context.issue;

	const pr = (await octokit.pulls.get({ owner, repo, pull_number })).data;

	const plugin = new SizePlugin({
		pattern: process.env.PATTERN || '**/dist/*.js',
		exclude: '*.map'
	});

	const cwd = process.cwd();

	console.log('computing new sizes');
	await exec(`npm ci && npm run build`);
	const newSizes = await plugin.readFromDisk(cwd);

	try {
		await exec(`git fetch -n ${pr.base.sha}`);
	} catch (e) {
		console.log('fetch failed', e.message);
	}

	console.log('computing old sizes');
	await exec(`git checkout ${pr.base.sha}`);
	await exec(`npm ci && npm run build`);
	const oldSizes = await plugin.readFromDisk(cwd);

	const diff = await plugin.getDiff(oldSizes, newSizes);

	const cliText = await plugin.printSizes(diff);
	console.log('SIZE DIFFERENCES:\n\n' + cliText);

	const markdownDiff = diffTable(diff);

	await octokit.issues.createComment({
		...context.repo,
		issue_number: pull_number,
		body: markdownDiff
	});
}

function diffTable(files, showTotal) {
	let out = `| Filename | Size | Difference | |\n`;
	out += `| ---:|:---:|:---:|:---:|\n`;
	let totalSize = 0;
	let totalDelta = 0;
	for (const file of files) {
		const { filename, size, delta } = file;
		totalSize += size;
		totalDelta += delta;
		
		const difference = (delta / size * 100) | 0;
		let deltaText = getDeltaText(delta, difference);
		let icon = iconForDifference(difference);
		out += `| \`${filename}\` | ${prettyBytes(size)} | ${deltaText} | ${icon} |\n`;
	}

	if (showTotal) {
		const totalDifference = (totalDelta / totalSize * 100) | 0;
		let totalDeltaText = getDeltaText(totalDelta, totalDifference);
		let totalIcon = iconForDifference(totalDifference);
		out = `**Total Size:** ${prettyBytes(totalSize)}\n\n`;
		out = `**Size Change:** ${totalDeltaText} ${totalIcon}\n\n`;
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
	if (difference >= 5) icon = '🔍';
	else if (difference >= 10) icon = '⚠️';
	else if (difference >= 20) icon = '🚨';
	else if (difference >= 50) icon = '🆘';
	else if (difference <= -5) icon = '✅';
	else if (difference <= -10) icon = '👏';
	else if (difference <= 20) icon = '🎉';
	else if (difference <= 50) icon = '🏆';
	return icon;
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
