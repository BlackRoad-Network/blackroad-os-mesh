const REQUIRED_CHECKS = [
  'build-and-test (22.x)', 'build-and-test (24.x)',
  'Mesh dependency audit', 'Mesh secret scan', 'Mesh CodeQL analysis',
  'Repository verification', 'check-compliance',
  'Worker integration',
];

function eligible(pr, repository) {
  return pr.state === 'open' && pr.draft === false &&
    pr.user?.login === 'github-actions[bot]' &&
    pr.head?.ref === 'blackroad-auto-fix' &&
    pr.head?.repo?.full_name === repository &&
    pr.base?.repo?.full_name === repository &&
    ['main', 'master'].includes(pr.base?.ref);
}

function evaluate(pr, repository, checks, statuses) {
  if (!eligible(pr, repository)) return 'PR is outside the bot auto-fix scope';
  if (pr.mergeable !== true || pr.mergeable_state !== 'clean') return 'GitHub has not reported a clean merge state';
  if (!Array.isArray(checks) || !checks.length || !Array.isArray(statuses)) return 'Check evidence is absent';
  if (checks.some(c => c.head_sha !== pr.head.sha || c.status !== 'completed' ||
      !['success', 'neutral', 'skipped'].includes(c.conclusion))) return 'Checks are stale, pending, or unsuccessful';
  for (const name of REQUIRED_CHECKS) {
    if (!checks.some(c => c.name === name && c.conclusion === 'success' &&
        c.app?.slug === 'github-actions')) return `Required check has not passed: ${name}`;
  }
  if (statuses.some(s => s.sha !== pr.head.sha || s.state !== 'success')) return 'Commit status is stale, pending, or unsuccessful';
  return null;
}

async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const repository = `${owner}/${repo}`;
  const candidates = context.payload.pull_request ? [context.payload.pull_request] :
    await github.paginate(github.rest.pulls.list, { owner, repo, state: 'open', head: `${owner}:blackroad-auto-fix`, per_page: 100 });
  for (const candidate of candidates) {
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: candidate.number });
    if (!eligible(pr, repository)) { core.info(`PR #${pr.number}: outside auto-fix scope`); continue; }
    const checks = await github.paginate(github.rest.checks.listForRef,
      { owner, repo, ref: pr.head.sha, filter: 'latest', per_page: 100 });
    const allStatuses = await github.paginate(github.rest.repos.listCommitStatusesForRef,
      { owner, repo, ref: pr.head.sha, per_page: 100 });
    // The statuses API returns newest first. Preserve the latest result per context.
    const statuses = [...new Map(allStatuses.slice().reverse().map(s => [s.context, s])).values()]
      .map(s => ({ ...s, sha: pr.head.sha })); // REST statuses omit SHA; fetched at this immutable ref.
    const ownRun = `https://github.com/${repository}/actions/runs/${context.runId}`;
    const relevantChecks = checks.filter(c => !(c.name === 'Auto-Merge Compliant PRs' &&
      c.app?.slug === 'github-actions' &&
      (c.details_url === ownRun || c.details_url?.startsWith(`${ownRun}/`))));
    const reason = evaluate(pr, repository, relevantChecks, statuses);
    if (reason) { core.info(`PR #${pr.number}: ${reason}`); continue; }
    // Re-read eligibility immediately before the write. The merge endpoint also
    // enforces repository protections and atomically checks this exact head SHA.
    const { data: current } = await github.rest.pulls.get({ owner, repo, pull_number: pr.number });
    if (current.head.sha !== pr.head.sha || evaluate(current, repository, relevantChecks, statuses)) {
      core.info(`PR #${pr.number}: state changed; no merge requested`);
      continue;
    }
    const { data: merged } = await github.rest.pulls.merge({ owner, repo,
      pull_number: pr.number, sha: pr.head.sha, merge_method: 'squash' });
    if (!merged.merged) throw new Error(`GitHub did not merge PR #${pr.number}`);
    core.info(`Merged PR #${pr.number} at ${merged.sha}`);
  }
}

module.exports = { REQUIRED_CHECKS, eligible, evaluate, run };
