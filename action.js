import { getInput, setFailed } from '@actions/core';
import { GitHub, context } from '@actions/github';
import { exec } from '@actions/exec';
import SizePlugin from 'size-plugin-core';
import prettyBytes from 'pretty-bytes';


async function run(octokit, context) {
	const { owner, repo, number: pull_number } = context.issue;

	const pr = (await octokit.pulls.get({ owner, repo, pull_number })).data;

	const plugin = new SizePlugin({
		pattern: getInput('pattern') || '**/dist/*.js',
		exclude: getInput('exclude') || '{**/*.map,**/node_modules/**}'
	});

	const cwd = process.cwd();

	console.log('computing new sizes');
	await exec(`npm ci`);
	await exec(`npm run build`);
	const newSizes = await plugin.readFromDisk(cwd);

	try {
		await exec(`git fetch -n origin ${pr.base.sha}`);
		console.log('successfully fetched refspec');
	} catch (e) {
		console.log('refspec fetch failed', e.message);
		try {
			await exec(`git fetch -n`);
		} catch (e) {
			console.log('fetch failed', e.message);
		}
	}

	console.log('computing old sizes');
	await exec(`git checkout ${pr.base.sha}`);
	await exec(`npm ci`);
	await exec(`npm run build`);
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
		body: markdownDiff + '\n\n<sub>gzip-size-action</sub>'
	};

	let commentId;
	try {
		const comments = (await octokit.issues.listComments(commentInfo)).data;
		for (let i=comments.length; i--; ) {
			// TODO: check owner.login VS comment.user.login
			console.log('checking comment', {
				commentUserLogin: comments[i].user.login,
				commentUserId: comments[i].user.id,
				ownerLogin: context.user && context.user.login,
				ownerId: context.user && context.user.id
			});
			if (/<sub>[\s\n]*gzip-size-action/.test(comments[i].body)) {
				commentId = comments[i].id;
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
	let totalSize = 0;
	let totalDelta = 0;
	let changes = 0;
	for (const file of files) {
		const { filename, size, delta } = file;
		totalSize += size;
		totalDelta += delta;

		if (omitUnchanged && Math.abs(delta) < 1) continue;
		changes++;
		const difference = (delta / size * 100) | 0;
		let deltaText = getDeltaText(delta, difference);
		let icon = iconForDifference(difference);
		out += `| \`${filename}\` | ${prettyBytes(size)} | ${deltaText} | ${icon} |\n`;
	}

	if (collapseUnchanged && changes === 0) {
		out = `<details><summary>🎯 <strong>No size changes</strong> <em>(click to view)</em></summary>\n\n${out}\n\n</details>`;
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

const toBool = v => /^(1|true|yes)$/.test(v);

(async () => {
	try {
		const token = getInput('repo-token', { required: true });
		const octokit = new GitHub(token);
		await run(octokit, context);
	} catch (e) {
		setFailed(e.message);
	}
})();
