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
Storage and Durable Object bindings in these unit tests are test doubles. Two
additional tests verify failed live forwarding returns HTTP 503 while preserving
the stored event. The emitted test build is not evidence of production deployment.

Run `npm run test:integration` for four tests in the actual local Worker engine.
The command bundles the Worker with Wrangler's dry-run mode, then uses Miniflare
with local KV and Durable Object bindings read from wrangler.local.toml. It tests
HTTP health and KV persistence, WebSocket heartbeat/broadcast, named rooms and
direct messages, and HTTP-to-WebSocket forwarding. Miniflare's version is pinned
to the version already required by Wrangler; no additional runtime package was
introduced. Local storage is ephemeral in this integration harness.

For interactive use, `npm run dev` starts Wrangler on 127.0.0.1:8787 with local
bindings. The sandbox used for this repair could run the direct Worker engine but
could not start Wrangler's interactive server because host network-interface
enumeration was unavailable. No host restriction was modified.

These checks do not certify deployed connectivity, client authorization,
hibernation recovery, long-term durability, or production capacity. Broadcast
forwarding is not a guarantee that disconnected clients receive past messages.

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

Railway and the existing Dockerfile also call `npm start`, which does not exist.
The Railway workflow now fails with that specific runtime mismatch before trying
to deploy. A compatible Node adapter or a verified Worker deployment target is
required; adding a token alone does not fix this mismatch.

The production Wrangler entry point now correctly names src/index.ts. Its real
account/resource bindings and migrations still need verification. The separate
local configuration declares all required local bindings without remote IDs and
must not be used as a production deployment configuration.

Remember the Road. Pave Tomorrow.
