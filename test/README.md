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
test harness. `npm test` builds first, then runs six tests using Node's built-in
runner. Failures return a nonzero status to CI.

The tests cover health, WebSocket upgrade rejection, broadcast validation and
event persistence, global presence forwarding, and empty-room HTTP behavior.
Storage and Durable Object bindings are test doubles. These tests do not verify
deployed connectivity, real WebSocket upgrades, hibernation, or delivery of
persisted broadcast events to WebSocket clients. The emitted test build is not
evidence of a working production deployment.

The Trinity workflow checks its directory structure and Bash syntax. Its
`trinity-record-test.sh` helper records supplied results in a workstation SQLite
database; it is not a test suite and is not invoked without arguments by CI.

## Remaining deployment and automation work

At the start of this repair, Railway logs showed an empty `RAILWAY_TOKEN` and
rejected deployment. No credential has been added or bypassed.

The existing `security.yml`, `blackroad-auto-merge.yml`, and
`master-blackroad-workflow.yml` workflows contain invalid YAML. They also need
behavior review: swallowed scanner failures, acceptance of absent check results,
and simulated integration success are not reliable validation. This repair does
not activate those automations merely by correcting their indentation.

The existing Wrangler configuration points at `src/index.js`, while the tracked
entry point is `src/index.ts`, and does not declare the bindings required by the
service. Production deployment needs a separate verified configuration change.

Remember the Road. Pave Tomorrow.
