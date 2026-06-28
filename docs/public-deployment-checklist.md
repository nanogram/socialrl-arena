# Public Deployment Checklist

Use this after the repository has a GitHub remote.

## GitHub

```bash
git remote add origin <github-repo-url>
git push -u origin main
```

Confirm the CI workflow passes on GitHub Actions. It runs preflight, smoke load, demo seeding, target-load artifact generation, and the local final audit.

## Hosted App

Deploy the app as a Node or Docker web service.

Fast path: use the included `render.yaml` blueprint to create the web service and managed Postgres database from the GitHub repository.

Required runtime settings:

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=<managed-postgres-url>
```

Optional model settings:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=<key>
OPENAI_MODEL=<default-model>
OPENAI_DECISION_MODEL=<fast-classifier-model>
OPENAI_ROUTER_MODEL=<fast-router-model>
OPENAI_MESSAGE_MODEL=<chat-response-model>
OPENAI_REPORT_MODEL=<strong-report-model>
```

Health checks:

```bash
curl https://<host>/api/health
curl https://<host>/api/ready
```

## Seed Reviewer Demo

After the hosted service is ready:

```bash
DEMO_BASE_URL=https://<host> npm run demo:seed
```

Use the generated `demo-artifacts/<room-id>-links.md` file for the reviewer URLs.

## Final Links

Add these to the final handoff:

- Live demo: `https://<host>/rooms/<room-id>`
- Report: `https://<host>/rooms/<room-id>/report`
- Agent Review: `https://<host>/rooms/<room-id>/agents/mediator_v1`
- GitHub repo: `<github-repo-url>`
- Demo video: `<demo-video-url>`
