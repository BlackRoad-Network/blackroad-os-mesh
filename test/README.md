# Mesh verification

We access it all at RoadOS.
We collaborate with Roadies.
We code in Road.

This repository currently implements the mesh service in TypeScript on Hono and
Cloudflare Workers. The shared brand does not imply a completed Road migration.

Use Node.js 22 or 24 and the committed npm lockfile:

```sh
npm ci
npm test
```

`npm run build` checks TypeScript and emits CommonJS into `dist/` for the Node
test harness. `npm test` builds first, then runs the tests using Node's built-in
runner. Failures return a nonzero status to CI.

Six HTTP tests cover health, WebSocket upgrade rejection, broadcast validation and
event persistence, global presence forwarding, and empty-room HTTP behavior.
Storage and Durable Object bindings are test doubles. These tests do not verify
deployed connectivity, real WebSocket upgrades, hibernation, or delivery of
persisted broadcast events to WebSocket clients. The emitted test build is not
evidence of a working production deployment.

The Trinity workflow checks its directory structure and Bash syntax. Its
`trinity-record-test.sh` helper records supplied results in a workstation SQLite
database; it is not a test suite and is not invoked without arguments by CI.

## Automation verification

Twenty additional tests cover the bot auto-merge policy. Only same-repository,
non-draft PRs authored by github-actions[bot] on blackroad-auto-fix are eligible.
All observed checks must finish successfully or be neutral/skipped, and each
named required build, security, canon, and Trinity check must explicitly succeed.
Pending, absent, stale, failed, cancelled, and incomplete evidence blocks a merge.
The policy re-reads PR state and sends the reviewed head SHA to GitHub's merge
endpoint. Repository protections remain authoritative; no bypass is requested.
Its workflow loads policy code from the trusted default branch, never a PR head.
These are local policy tests; an automatic merge has not been exercised live.

The Security workflow runs CodeQL for TypeScript, audits locked npm dependencies
at moderate severity or above, and scans Git history using checksum-pinned
Gitleaks 8.30.1 with fully redacted output. Scanner failures propagate to CI.
The master workflow runs the build/tests, checks shared canon and Trinity Bash
syntax, and reports its actual job result. External authentication, coordination,
task creation, diagrams, notifications, and memory logging are explicitly marked
as not implemented in that workflow. It does not issue simulated approvals.

## Remaining deployment work

At the start of this repair, Railway logs showed an empty `RAILWAY_TOKEN` and
rejected deployment. No credential has been added or bypassed.

The existing Wrangler configuration points at `src/index.js`, while the tracked
entry point is `src/index.ts`, and does not declare the bindings required by the
service. Production deployment needs a separate verified configuration change.

Remember the Road. Pave Tomorrow.
