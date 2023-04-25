import path from 'path';
import { getInput, setFailed, startGroup, endGroup, debug } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { exec } from '@actions/exec';
import SizePlugin from 'size-plugin-core';
import { fileExists, diffTable, toBool, stripHash } from './utils.js';

/**
 * @typedef {ReturnType<typeof import("@actions/github").getOctokit>} Octokit
 * @typedef {typeof import("@actions/github").context} ActionContext
 * @param {Octokit} octokit
 * @param {ActionContext} context
 * @param {string} token
 */
async function run(octokit, context, token) {
	const { owner, repo, number: pull_number } = context.issue;

	// const pr = (await octokit.pulls.get({ owner, repo, pull_number })).data;
	try {
		debug('pr' + JSON.stringify(context.payload, null, 2));
	} catch (e) {}

	let baseSha, baseRef;
	if (context.eventName == 'push') {
		baseSha = context.payload.before;
		baseRef = context.payload.ref;

		console.log(`Pushed new commit on top of ${baseRef} (${baseSha})`);
	} else if (context.eventName == 'pull_request' || context.eventName == 'pull_request_target') {
		const pr = context.payload.pull_request;
		baseSha = pr.base.sha;
		baseRef = pr.base.ref;

		console.log(`PR #${pull_number} is targeted at ${baseRef} (${baseRef})`);
	} else {
		throw new Error(
			`Unsupported eventName in github.context: ${context.eventName}. Only "pull_request", "pull_request_target", and "push" triggered workflows are currently supported.`
		);
	}

	if (getInput('cwd')) process.chdir(getInput('cwd'));

	const plugin = new SizePlugin({
		compression: getInput('compression'),
		pattern: getInput('pattern') || '**/dist/**/*.{js,mjs,cjs}',
		exclude: getInput('exclude') || '{**/*.map,**/node_modules/**}',
		stripHash: stripHash(getInput('strip-hash'))
	});

	const buildScript = getInput('build-script') || 'build';
	const cwd = process.cwd();

	let yarnLock = await fileExists(path.resolve(cwd, 'yarn.lock'));
	let pnpmLock = await fileExists(path.resolve(cwd, 'pnpm-lock.yaml'));
	let packageLock = await fileExists(path.resolve(cwd, 'package-lock.json'));

	let packageManager = 'npm';
	let installScript = 'npm install';
	if (yarnLock) {
		installScript = 'yarn --frozen-lockfile';
		packageManager = 'yarn';
	} else if (pnpmLock) {
		installScript = 'pnpm install --frozen-lockfile';
		packageManager = 'pnpm';
	} else if (packageLock) {
		installScript = 'npm ci';
	}

	if (getInput('install-script')) {
		installScript = getInput('install-script');
	}

	startGroup(`[current] Install Dependencies`);
	console.log(`Installing using ${installScript}`);
	await exec(installScript);
	endGroup();

	startGroup(`[current] Build using ${packageManager}`);
	console.log(`Building using ${packageManager} run ${buildScript}`);
	await exec(`${packageManager} run ${buildScript}`);
	endGroup();

	// In case the build step alters a JSON-file, ....
	await exec(`git reset --hard`);

	const newSizes = await plugin.readFromDisk(cwd);

	startGroup(`[base] Checkout target branch`);
	try {
		if (!baseRef) throw Error('missing context.payload.pull_request.base.ref');
		await exec(`git fetch -n origin ${baseRef}`);
		console.log('successfully fetched base.ref');
	} catch (e) {
		console.log('fetching base.ref failed', e.message);
		try {
			await exec(`git fetch -n origin ${baseSha}`);
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
		await exec(`git reset --hard ${baseRef}`);
	} catch (e) {
		await exec(`git reset --hard ${baseSha}`);
	}
	endGroup();

	const cleanScript = getInput('clean-script');
	if (cleanScript) {
		startGroup(`[base] Cleanup via ${packageManager} run ${cleanScript}`);
		await exec(`${packageManager} run ${cleanScript}`);
		endGroup();
	}

	startGroup(`[base] Install Dependencies`);

	yarnLock = await fileExists(path.resolve(cwd, 'yarn.lock'));
	pnpmLock = await fileExists(path.resolve(cwd, 'pnpm-lock.yaml'));
	packageLock = await fileExists(path.resolve(cwd, 'package-lock.json'));

	packageManager = 'npm';
	installScript = 'npm install';
	if (yarnLock) {
		installScript = `yarn --frozen-lockfile`;
		packageManager = `yarn`;
	} else if (pnpmLock) {
		installScript = `pnpm install --frozen-lockfile`;
		packageManager = `pnpm`;
	} else if (packageLock) {
		installScript = `npm ci`;
	}

	if (getInput('install-script')) {
		installScript = getInput('install-script');
	}

	console.log(`Installing using ${installScript}`);
	await exec(installScript);
	endGroup();

	startGroup(`[base] Build using ${packageManager}`);
	await exec(`${packageManager} run ${buildScript}`);
	endGroup();

	// In case the build step alters a JSON-file, ....
	await exec(`git reset --hard`);

	const oldSizes = await plugin.readFromDisk(cwd);

	const diff = await plugin.getDiff(oldSizes, newSizes);

	startGroup(`Size Differences:`);
	const cliText = await plugin.printSizes(diff);
	console.log(cliText);
	endGroup();

	const markdownDiff = diffTable(diff, {
		collapseUnchanged: toBool(getInput('collapse-unchanged')),
		omitUnchanged: toBool(getInput('omit-unchanged')),
		showTotal: toBool(getInput('show-total')),
		minimumChangeThreshold: parseInt(getInput('minimum-change-threshold'), 10)
	});

	let outputRawMarkdown = false;

	const commentInfo = {
		...context.repo,
		issue_number: pull_number
	};

	const comment = {
		...commentInfo,
		body:
			markdownDiff +
			'\n\n<a href="https://github.com/preactjs/compressed-size-action"><sub>compressed-size-action</sub></a>'
	};

	if (context.eventName !== 'pull_request' && context.eventName !== 'pull_request_target') {
		console.log('No PR associated with this action run. Not posting a check or comment.');
		outputRawMarkdown = false;
	} else if (toBool(getInput('use-check'))) {
		if (token) {
			const finish = await createCheck(octokit, context);
			await finish({
				conclusion: 'success',
				output: {
					title: `Compressed Size Action`,
					summary: markdownDiff
				}
			});
		} else {
			outputRawMarkdown = true;
		}
	} else {
		startGroup(`Updating stats PR comment`);
		let commentId;
		try {
			const comments = (await octokit.issues.listComments(commentInfo)).data;
			for (let i = comments.length; i--; ) {
				const c = comments[i];
				if (c.user.type === 'Bot' && /<sub>[\s\n]*(compressed|gzip)-size-action/.test(c.body)) {
					commentId = c.id;
					break;
				}
			}
		} catch (e) {
			console.log('Error checking for previous comments: ' + e.message);
		}

		if (commentId) {
			console.log(`Updating previous comment #${commentId}`);
			try {
				await octokit.issues.updateComment({
					...context.repo,
					comment_id: commentId,
					body: comment.body
				});
			} catch (e) {
				console.log('Error editing previous comment: ' + e.message);
				commentId = null;
			}
		}

		// no previous or edit failed
		if (!commentId) {
			console.log('Creating new comment');
			try {
				await octokit.issues.createComment(comment);
			} catch (e) {
				console.log(`Error creating comment: ${e.message}`);
				console.log(`Submitting a PR review comment instead...`);
				try {
					const issue = context.issue;
					await octokit.pulls.createReview({
						owner: issue.owner,
						repo: issue.repo,
						pull_number: issue.number,
						event: 'COMMENT',
						body: comment.body
					});
				} catch (e) {
					console.log('Error creating PR review.');
					outputRawMarkdown = true;
				}
			}
		}
		endGroup();
	}

	if (outputRawMarkdown) {
		console.log(
			`
			Error: compressed-size-action was unable to comment on your PR.
			This can happen for PR's originating from a fork without write permissions.
			You can copy the size table directly into a comment using the markdown below:
			\n\n${comment.body}\n\n
		`.replace(/^(\t|  )+/gm, '')
		);
	}

	console.log('All done!');
}

/**
 * Create a check and return a function that updates (completes) it
 * @param {Octokit} octokit
 * @param {ActionContext} context
 */
async function createCheck(octokit, context) {
	const check = await octokit.checks.create({
		...context.repo,
		name: 'Compressed Size',
		head_sha: context.payload.pull_request.head.sha,
		status: 'in_progress'
	});

	return async (details) => {
		await octokit.checks.update({
			...context.repo,
			check_run_id: check.data.id,
			completed_at: new Date().toISOString(),
			status: 'completed',
			...details
		});
	};
}

(async () => {
	try {
		const token = getInput('repo-token');
		const octokit = getOctokit(token);
		await run(octokit, context, token);
	} catch (e) {
		setFailed(e.message);
	}
})();
