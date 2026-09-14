const { test } = require('node:test');
const assert = require('node:assert/strict');
const { REQUIRED_CHECKS, evaluate, run } = require('../scripts/auto-merge.cjs');
const repository = 'BlackRoad-Network/blackroad-os-mesh';
const fixture = () => ({
  pr: { number: 7, state: 'open', draft: false, user: { login: 'github-actions[bot]' },
    head: { sha: 'abc123', ref: 'blackroad-auto-fix', repo: { full_name: repository } },
    base: { ref: 'main', repo: { full_name: repository } }, mergeable: true, mergeable_state: 'clean' },
  checks: REQUIRED_CHECKS.map(name => ({ name, head_sha: 'abc123', status: 'completed',
    conclusion: 'success', app: { slug: 'github-actions' } })),
});

test('accepts only a clean bot PR with all required successful checks', () => {
  const { pr, checks } = fixture();
  assert.equal(evaluate(pr, repository, checks, []), null);
});

for (const [name, change] of [
  ['human author', p => p.user.login = 'human'],
  ['draft', p => p.draft = true],
  ['closed PR', p => p.state = 'closed'],
  ['fork', p => p.head.repo.full_name = 'other/mesh'],
  ['wrong branch', p => p.head.ref = 'feature'],
  ['blocked merge', p => p.mergeable_state = 'blocked'],
  ['unknown mergeability', p => p.mergeable = null],
]) test(`rejects ${name}`, () => {
  const { pr, checks } = fixture(); change(pr);
  assert.ok(evaluate(pr, repository, checks, []));
});

for (const state of ['queued', 'in_progress']) test(`rejects ${state} checks`, () => {
  const { pr, checks } = fixture(); checks[0].status = state;
  assert.ok(evaluate(pr, repository, checks, []));
});

for (const result of ['failure', 'cancelled', 'timed_out', 'action_required', null, 'skipped']) {
  test(`rejects required check result ${result}`, () => {
    const { pr, checks } = fixture(); checks[0].conclusion = result;
    assert.ok(evaluate(pr, repository, checks, []));
  });
}

test('rejects absent, incomplete, stale, and externally named check evidence', () => {
  const { pr, checks } = fixture();
  for (const missing of [null, [], checks.slice(1)]) assert.ok(evaluate(pr, repository, missing, []));
  checks[0].head_sha = 'old'; assert.ok(evaluate(pr, repository, checks, []));
  checks[0].head_sha = pr.head.sha; checks[0].app.slug = 'other-app';
  assert.ok(evaluate(pr, repository, checks, []));
});

test('rejects unsuccessful additional checks and commit statuses', () => {
  const { pr, checks } = fixture();
  assert.ok(evaluate(pr, repository, [...checks, { ...checks[0], name: 'extra', conclusion: 'failure' }], []));
  for (const state of ['pending', 'failure', 'error']) {
    assert.ok(evaluate(pr, repository, checks, [{ sha: pr.head.sha, state }]));
  }
  assert.ok(evaluate(pr, repository, checks, [{ sha: 'old', state: 'success' }]));
});

function apiHarness(changed = false) {
  const { pr, checks } = fixture(); const merges = []; let reads = 0;
  const github = { rest: {
    pulls: { get: async () => ({ data: { ...pr, head: { ...pr.head,
      sha: changed && reads++ > 0 ? 'new-head' : pr.head.sha } } }),
      merge: async args => { merges.push(args); return { data: { merged: true, sha: 'merged' } }; } },
    checks: { listForRef: 'checks' }, repos: { listCommitStatusesForRef: 'statuses' },
  }, paginate: async endpoint => endpoint === 'checks' ? checks : [] };
  return { github, merges, context: { repo: { owner: 'BlackRoad-Network', repo: 'blackroad-os-mesh' },
    payload: { pull_request: pr }, runId: 123 }, core: { info() {} } };
}

test('does not merge when the head moves during validation', async () => {
  const harness = apiHarness(true); await run(harness); assert.equal(harness.merges.length, 0);
});

test('merge request includes the reviewed head SHA and no bypass option', async () => {
  const harness = apiHarness(); await run(harness);
  assert.deepEqual(harness.merges, [{ owner: 'BlackRoad-Network', repo: 'blackroad-os-mesh',
    pull_number: 7, sha: 'abc123', merge_method: 'squash' }]);
});
