import { getInput, setFailed, startGroup, endGroup, debug } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { exec } from '@actions/exec';
import SizePlugin from 'size-plugin-core';
import { getPackageManagerAndInstallScript, diffTable, toBool, stripHash } from './utils.js';

const inputs = {
	repoToken: getInput('repo-token'),
	cleanScript: getInput('clean-script'),
	installScript: getInput('install-script'),
	buildScript: getInput('build-script') || 'build',

	compression: getInput('compression'),
	showTotal: toBool(getInput('show-total')),
	collapseUnchanged: toBool(getInput('collapse-unchanged')),
	omitUnchanged: toBool(getInput('omit-unchanged')),
	stripHash: getInput('strip-hash'),
	useCheck: toBool(getInput('use-check')),
	minimumChangeThreshold: parseInt(getInput('minimum-change-threshold'), 10) || 1,
	pattern: getInput('pattern') || '**/dist/**/*.{js,mjs,cjs}',
	exclude: getInput('exclude') || '{**/*.map,**/node_modules/**}',
	cwd: getInput('cwd'),
	commentKey: getInput('comment-key')
};

/**
 * @typedef {ReturnType<typeof import("@actions/github").getOctokit>} Octokit
 * @typedef {typeof import("@actions/github").context} ActionContext
 */

/**
 * @param {Octokit} octokit
 * @param {ActionContext} context
 * @param {string} token
 */
async function run(octokit, context, token) {
	const { number: pull_number } = context.issue;


  //repo-token:
  //  description: 'The GITHUB_TOKEN secret'
  //  required: false
  //  default: ${{ github.token }}
  //clean-script:
  //  description: 'An npm-script that cleans/resets state between branch builds'
  //install-script:
  //  required: false
  //  description: 'Custom installation script to run to set up the dependencies in your project'
  //build-script:
  //  description: 'The npm-script to run that builds your project'
  //  default: 'build'
  //compression:
  //  description: 'The compression algorithm to use: "gzip" or "brotli"'
  //show-total:
  //  description: 'Show total size and difference.'
  //  default: 'true'
  //collapse-unchanged:
  //  description: 'Move unchanged files into a separate collapsed table'
  //  default: 'true'
  //omit-unchanged:
  //  description: 'Exclude unchanged files from the sizes table entirely'
  //strip-hash:
  //  description: 'A regular expression to remove hashes from filenames. Submatches are turned into asterisks if present, otherwise the whole match is removed.'
  //use-check:
  //  description: 'Report status as a CI Check instead of using a comment [experimental]'
  //minimum-change-threshold:
  //  description: 'Consider files with changes below this threshold as unchanged. Specified in bytes.'
  //  default: 1
  //pattern:
  //  description: 'minimatch pattern of files to track'
  //exclude:
  //  description: 'minimatch pattern of files NOT to track'
  //cwd:
  //  description: 'A custom working directory to execute the action in relative to repo root (defaults to .)'
  //comment-key:

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

	if (inputs.cwd) process.chdir(inputs.cwd);

	const plugin = new SizePlugin({
		compression: inputs.compression,
		pattern: inputs.pattern,
		exclude: inputs.exclude,
		stripHash: stripHash(inputs.stripHash)
	});

	const cwd = process.cwd();

	let { packageManager, installScript } = await getPackageManagerAndInstallScript(cwd);
	if (inputs.installScript) {
		installScript = inputs.installScript;
	}

	startGroup(`[current] Install Dependencies`);
	console.log(`Installing using ${installScript}`);
	await exec(installScript);
	endGroup();

	startGroup(`[current] Build using ${packageManager}`);
	console.log(`Building using ${packageManager} run ${inputs.buildScript}`);
	await exec(`${packageManager} run ${inputs.buildScript}`);
	endGroup();

	// In case the build step alters a JSON-file, ....
	await exec(`git reset --hard`);

	const newSizes = await plugin.readFromDisk(cwd);

	startGroup(`[base] Checkout target branch`);
	try {
		if (!baseRef) throw Error('missing context.payload.pull_request.base.ref');
		await exec(`git fetch -n origin ${baseRef}:${baseRef}`);
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

	if (inputs.cleanScript) {
		startGroup(`[base] Cleanup via ${packageManager} run ${inputs.cleanScript}`);
		await exec(`${packageManager} run ${inputs.cleanScript}`);
		endGroup();
	}

	startGroup(`[base] Install Dependencies`);

	({ packageManager, installScript } = await getPackageManagerAndInstallScript(cwd));
	if (inputs.installScript) {
		installScript = inputs.installScript;
	}

	console.log(`Installing using ${installScript}`);
	await exec(installScript);
	endGroup();

	startGroup(`[base] Build using ${packageManager}`);
	await exec(`${packageManager} run ${inputs.buildScript}`);
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

	const commentKey = getInput('comment-key')

	const comment = {
		...commentInfo,
		body:
			markdownDiff +
			`<a href="https://github.com/preactjs/compressed-size-action"><sub>compressed-size-action${commentKey ? `::${commentKey}` : ''}</sub></a>`
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
			const commentRegExp = new RegExp(`<sub>[\s\n]*(compressed|gzip)-size-action${commentKey ? `::${commentKey}` : ''}</sub>`)
			for (let i = comments.length; i--; ) {
				const c = comments[i];
				if (commentRegExp.test(c.body)) {
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
		const octokit = getOctokit(inputs.repoToken);
		await run(octokit, context, inputs.repoToken);
	} catch (e) {
		setFailed(e.message);
	}
})();
