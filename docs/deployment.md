# Deployment Notes

## Local

```bash
npm install
npm start
```

The app stores room state in `data/rooms.json` unless `DATABASE_URL` is set.
With Postgres, the app writes both full room snapshots and normalized rows for messages, agent decisions, routing decisions, report jobs, feedback, and generated reports.

For load testing without disk persistence overhead:

```bash
SOCIALRL_STORAGE=memory npm start
```

## Docker Compose

```bash
docker compose up --build
docker compose exec app npm run migrate:postgres
```

Open `http://localhost:3000`.

## Hosted Node

Required:

- Node 20+
- `npm ci --omit=dev`
- `npm start`
- Persistent disk for file-backed storage or a Postgres `DATABASE_URL`

Recommended environment:

```bash
PORT=3000
DATABASE_URL=postgres://...
LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.5
```

Optional per-stage OpenAI overrides:

```bash
OPENAI_DECISION_MODEL=...
OPENAI_ROUTER_MODEL=...
OPENAI_MESSAGE_MODEL=...
OPENAI_REPORT_MODEL=...
```

Use lower-latency models for `OPENAI_DECISION_MODEL` and `OPENAI_ROUTER_MODEL`, then a stronger model for `OPENAI_REPORT_MODEL` when report quality matters more than speed.

For a generic HTTP model adapter, set `LLM_PROVIDER=http` with any combination of:

```bash
LLM_DECISION_URL=https://model.example/decide
LLM_ROUTER_URL=https://model.example/route
LLM_MESSAGE_URL=https://model.example/message
LLM_REPORT_URL=https://model.example/report
```

Missing model endpoints fall back to the deterministic local implementation for that stage.

## Verification

```bash
npm test
npm run load-test:smoke
```

Run the target profile only when the host can handle the traffic:

```bash
npm run load-test:target
```

## App Routes

- `/rooms/:roomId` - realtime chat and debug/eval view
- `/create` - create-room dashboard and recent rooms
- `/rooms/:roomId/report` - latest session report page
- `/rooms/:roomId/shapes/:agentId` - latest Shape review page for one agent

## API Routes

- `/api/health` - process health
- `/api/ready` - readiness, storage, provider, queue, and room counts
- `/api/rooms` - recent room summaries
- `/api/rooms/:roomId` - serialized room state
- `/api/rooms/:roomId/export` - transcript and report export
- `/api/rooms/:roomId/reports/latest` - latest report JSON
- `/api/rooms/:roomId/reports/:reportId` - specific report JSON
- `/api/rooms/:roomId/shapes/:agentId` - latest Shape report JSON for one agent
