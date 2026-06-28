# Final Deliverable Checklist

## Required Links

- Live demo: deploy the app and use the resulting `/create` or seeded room URL.
- GitHub repo: push this project repository.
- 90-second Loom: record the flow from `docs/demo-script.md`.
- One-page writeup: `docs/evaluating-ai-as-group-chat-participant.md`.
- Deployment checklist: `docs/public-deployment-checklist.md`.

## Local Package Generation

Start the app:

```bash
npm start
```

Seed a complete before/after demo room:

```bash
npm run demo:seed
```

This creates:

- `demo-artifacts/<room-id>-export.json`
- `demo-artifacts/<room-id>-links.md`

Run final local verification:

```bash
npm run preflight
npm run load-test:smoke
npm run load-test:target-artifact
npm run final-audit:local
npm run final-handoff
```

The target-load command writes `demo-artifacts/target-load-latest.json`, which `npm run final-audit` validates against the spec's 100-room / 300-user / 300-agent / 1,000-message profile.

The handoff command writes `demo-artifacts/final-handoff.md`, a local summary of the latest seeded demo, target-load evidence, audit status, and remaining external links.

After GitHub, deployment, and Loom are ready, audit the final handoff links:

```bash
LIVE_DEMO_URL=https://<host>/rooms/<room-id> \
GITHUB_REPO_URL=https://github.com/<owner>/<repo> \
LOOM_URL=https://www.loom.com/share/<video-id> \
npm run final-audit
```

After pushing to GitHub, the `.github/workflows/ci.yml` workflow should run the same preflight and smoke-load gates against a memory-backed server.

## Reviewer Flow

1. Open the seeded chat URL.
2. Show the chat and debug/eval panel.
3. Open the report URL.
4. Open the Mediator Shape Review URL.
5. Export JSON.
6. Mention the target load result in `docs/performance-report.md`.
