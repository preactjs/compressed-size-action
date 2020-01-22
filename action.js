import { getInput, setFailed } from '@actions/core';
import { GitHub, context } from '@actions/github';
import { exec } from '@actions/exec';
import SizePlugin from 'size-plugin-core';


async function run(octokit, context) {
	const { owner, repo, number: pull_number } = context.issue;
	const pr = (await octokit.pulls.get({ owner, repo, pull_number })).data;

	const plugin = new SizePlugin({
		pattern: process.env.PATTERN || 'dist/*.js,**/dist/*.js',
		exclude: '*.map'
	});

	const cwd = process.cwd();

	console.log('computing new sizes');
	await exec(`npm ci && npm run build`);
	const newSizes = await plugin.readFromDisk(cwd);

	console.log('computing old sizes');
	await exec(`git checkout ${pr.base.sha}`);
	await exec(`npm ci && npm run build`);
	const oldSizes = await plugin.readFromDisk(cwd);

	const diff = await plugin.getDiff(oldSizes, newSizes);

	const text = await plugin.printSizes(diff);

	await octokit.issues.createComment({
		...context.repo,
		issue_number: pull_number,
		body: `Size updates:\n\n\n\n\`\`\`\n${text}\n\`\`\``,
	});
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
