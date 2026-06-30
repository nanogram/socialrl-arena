# SocialRL Arena

SocialRL Arena is a realtime group-chat eval demo. The first slice proves the core loop:

1. Humans send messages in a shared room.
2. AI agents decide whether to speak, wait, or stay silent.
3. AI responses stream into the room.
4. The system infers AI message reception from follow-up mood, replies, momentum, and memory use.
5. Ending the session generates Agent Performance Reports.
6. The report produces improved participation policies and before/after comparison data.

This implementation uses deterministic local agents by default so the product loop works without API keys. Optional OpenAI Responses and generic HTTP adapters can take over decision, routing, message, and report-judge stages while preserving the same event and report contracts.

Reports include automatic message reception, a social intelligence review, room memory ledger, and mood timeline so reviewers can see whether agents respected participant preferences, improved or worsened human mood, routed at the right time, and showed enough restraint without requiring users to label every AI message.

## Demo Video

![SocialRL Arena demo preview](https://nanogram.github.io/socialrl-arena/assets/socialrl-demo.gif)

Open the [demo video page](https://nanogram.github.io/socialrl-arena/) for video controls.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Useful Commands

```bash
npm test
npm run load-test:smoke
npm run load-test:target
npm run load-test:target-artifact
npm run demo:seed
npm run demo:record
npm run preflight
npm run final-audit:local
npm run final-audit
npm run final-handoff
```

`npm run demo:record` starts a memory-backed local server, seeds a fresh weekend-trip demo room, records the walkthrough, and regenerates `docs/assets/socialrl-demo.mp4` plus `docs/assets/socialrl-demo.gif`. Playwright and browser binaries are installed under `.local-tools` if they are missing, not globally.

For a clean local target load run, start the server with in-memory storage in one terminal:

```bash
npm run start:memory
```

Then run:

```bash
npm run load-test:target
```

With Postgres available:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/socialrl npm run migrate:postgres
DATABASE_URL=postgres://user:pass@localhost:5432/socialrl npm start
```

Without `DATABASE_URL`, the server uses local file-backed storage at `data/rooms.json`.

Optional external model service:

```bash
LLM_PROVIDER=openai \
OPENAI_API_KEY=... \
OPENAI_MODEL=gpt-5.5 \
npm start
```

`OPENAI_MODEL` is the default for every stage. To demonstrate model routing, override individual stages:

```bash
OPENAI_DECISION_MODEL=... \
OPENAI_ROUTER_MODEL=... \
OPENAI_MESSAGE_MODEL=... \
OPENAI_REPORT_MODEL=... \
npm start
```

Optional generic HTTP model service:

```bash
LLM_PROVIDER=http \
LLM_DECISION_URL=http://localhost:8787/decide \
LLM_ROUTER_URL=http://localhost:8787/route \
LLM_MESSAGE_URL=http://localhost:8787/message \
LLM_REPORT_URL=http://localhost:8787/report \
LLM_API_KEY=... \
npm start
```

The HTTP provider receives compact room state plus a versioned prompt. The decision endpoint returns `{ "decisions": [...] }`, the router endpoint returns `{ "routingDecision": {...}, "decisions": [...] }`, the message endpoint returns `{ "content": "..." }`, and the optional report endpoint returns a report judge patch with `{ "summary": "...", "agents": [...] }`. If a service is unavailable, the demo falls back to deterministic local agents.

## Docker

```bash
docker compose up --build
docker compose exec app npm run migrate:postgres
```

## Routes

- `/` - landing page
- `/rooms/:roomId` - realtime chat and debug/eval view
- `/rooms/:roomId/report` - latest session report page
- `/rooms/:roomId/agents/:agentId` - latest agent review page
- `/create` - room creation and recent-room dashboard

Operational APIs:

- `/api/health`
- `/api/ready`
- `/api/rooms`

## Architecture

```mermaid
flowchart LR
  Browser["Browser SPA\nlanding, create, chat, report, agent review"] <--> WS["Node WebSocket + HTTP server"]
  WS --> Rooms["In-memory multi-room cache"]
  WS --> Core["Agent orchestration core"]
  Core --> Decisions["Speak / wait / stay-silent decisions"]
  Core --> Router["Rule + optional model-assisted router"]
  Router --> ModelPlan["Per-stage model routing evidence"]
  Core --> Stream["Streaming AI response simulation"]
  Core --> Feedback["Message + session feedback"]
  Core --> Reports["Agent Performance Reports\npolicy diff + before/after comparison"]
  WS --> Queue["Report queue + worker"]
  Queue --> Reports
  WS --> Export["Transcript/report JSON export"]
  WS --> Store["File storage or Postgres"]
  Store --> Snapshot["Full room snapshots"]
  Store --> Tables["Normalized messages, decisions, routing, feedback, reports"]
  Core --> Providers["Local deterministic agents\nOpenAI Responses\nGeneric HTTP LLM"]
  Load["Synthetic WebSocket load test"] --> WS
```
