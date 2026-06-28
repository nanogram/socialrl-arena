# SocialRL Arena

SocialRL Arena is a realtime group-chat eval demo. The first slice proves the core loop:

1. Humans send messages in a shared room.
2. AI agents decide whether to speak, wait, or stay silent.
3. AI responses stream into the room.
4. Humans tag AI messages with group-chat-native feedback.
5. Ending the session generates Shape Performance Reports.
6. The report produces improved participation policies and before/after comparison data.

This implementation uses deterministic local agents by default so the product loop works without API keys. Optional OpenAI Responses and generic HTTP adapters can take over decision, routing, message, and report-judge stages while preserving the same event and report contracts.

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
npm run preflight
npm run final-audit:local
npm run final-audit
npm run final-handoff
```

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

## Current Scope

- Landing page at `/` with product loop entry points
- Create and join rooms through `/rooms/:roomId`
- Join/update a display name and see active human participants plus selected AI Shapes
- Invite links
- Scenario selection
- Nine scenarios covering planning, drama/conflict, casual hangout, fandom/RP, study/work, advice, game night, debate, and support/emotional rooms
- Weekend Trip Planning demo covers budget, nightlife, nature, and a derailing fourth friend
- Three agents: Mediator, Vibe Friend, and Observer
- Room setup enforces 2-3 selected AI Shapes per session
- WebSocket fanout
- Reply-to message targeting for human replies and AI responses to trigger messages
- Agent speak/wait/stay-silent decisions
- Decision metadata includes target users when a Shape should include a quieter participant
- Explicit stayed-silent and waited WebSocket events for debug/eval views
- Router decision panel with selected Shape, blocked Shapes, group state, and candidate scores
- Rule-based router policy for planning, tense, emotionally sensitive, chaotic, stalled, playful/high-momentum, and feedback-adjusted turns
- Streaming AI message simulation
- WebSocket payloads include spec-style snake_case aliases alongside internal camelCase fields
- WebSocket client events accept spec-style snake_case and camelCase field names, including event-level `room_id`
- Human and AI messages preserve sender identity for transcript export and normalized Postgres writes
- Full AI-message feedback taxonomy for timing, social awareness, usefulness, personality, and message quality
- Session-level feedback, including route-next agent preference
- Normal-mode end-of-session feedback prompt for useful/annoying/route-next/reached-decision/invite-again signals
- Late end-of-session feedback refreshes the latest Shape Report instead of being ignored
- Shape Performance Reports
- Agent routing success, messages-per-minute, human-before/after, human momentum lift, and suitability scores
- Reply-targeting, target-user, wrong-person, and quiet-participant targeting stats in agent reports
- Per-agent participation decision review showing recent speak/wait/stay-silent reasons, trigger messages, router selection, and feedback outcome
- Routing recommendations include session feedback route-next/useful/annoying vote evidence
- Report evidence manifest summarizes transcript, decisions, feedback, latency, agent config, scenario, and run archive inputs
- Report-generated policy diffs carried into the improved-policy rerun
- Side-by-side before/after comparison with baseline and improved metrics
- Run Archive card on reports summarizes baseline/current run transcripts, decisions, feedback, and reports
- Exported run archive preserves baseline and improved transcripts, decisions, feedback, and reports
- Agent-specific Shape pages with scorecard, quantitative stats, failure modes, policy diff, routing recommendation, and best/worst message context
- Normal chat mode keeps active participants, invite, end-session, and report actions visible without exposing debug panels
- Active policy/model/prompt visibility in the debug/eval panel
- Live debug/eval telemetry for latency, report queue, feedback counts, group state, active policy, and model steps
- Toggle between normal chat and debug/eval views
- Export transcript/report JSON with sender, reply, latency, token, model, prompt, and policy metadata
- Scripted sample session for quick demos
- File-backed local persistence
- Postgres schema, migration path, snapshots, and normalized table writes for messages, first-token/full-response latency, decisions, routing decisions, report jobs, feedback, and reports
- Optional HTTP LLM provider hook
- Optional OpenAI Responses API provider hook
- Per-stage OpenAI model routing for decision, router, message, and report calls
- Context-aware model-routing evidence showing fast tiers for classification/decision/routing/feedback and strong tiers for emotional/conflict responses, reports, and policy repair
- Optional external report judge for Shape Performance Reports
- Versioned decision/router/message/report judge prompt templates
- Report judge prompts include full transcript, decisions, routing, feedback, latency, agent config, and evidence manifests
- Synthetic WebSocket load test with message acknowledgement, first-token, feedback acknowledgement, report throughput, and socket-stability metrics
- Machine-readable target-load artifact for final audit
- Reported p50/p95/p99 fanout, first-token, and full-response latency fields
- External model fallback failures increment LLM error and timeout metrics in reports
- Reports include live active-room and process room-count context from the server worker
- Docker Compose deployment path
- Render blueprint for hosted web service plus managed Postgres
- 90-second demo script
- One-page writeup: `docs/evaluating-ai-as-group-chat-participant.md`
- Performance report: `docs/performance-report.md`
- Final deliverable checklist: `docs/final-deliverable.md`
- Public deployment checklist: `docs/public-deployment-checklist.md`
- GitHub Actions CI workflow for preflight and smoke load verification

## Routes

- `/` - landing page
- `/rooms/:roomId` - realtime chat and debug/eval view
- `/rooms/:roomId/report` - latest session report page
- `/rooms/:roomId/shapes/:agentId` - latest Shape review page
- `/create` - room creation and recent-room dashboard

Operational APIs:

- `/api/health`
- `/api/ready`
- `/api/rooms`

## Architecture

```mermaid
flowchart LR
  Browser["Browser SPA\nlanding, create, chat, report, Shape review"] <--> WS["Node WebSocket + HTTP server"]
  WS --> Rooms["In-memory multi-room cache"]
  WS --> Core["Agent orchestration core"]
  Core --> Decisions["Speak / wait / stay-silent decisions"]
  Core --> Router["Rule + optional model-assisted router"]
  Router --> ModelPlan["Per-stage model routing evidence"]
  Core --> Stream["Streaming AI response simulation"]
  Core --> Feedback["Message + session feedback"]
  Core --> Reports["Shape Performance Reports\npolicy diff + before/after comparison"]
  WS --> Queue["Report queue + worker"]
  Queue --> Reports
  WS --> Export["Transcript/report JSON export"]
  WS --> Store["File storage or Postgres"]
  Store --> Snapshot["Full room snapshots"]
  Store --> Tables["Normalized messages, decisions, routing, feedback, reports"]
  Core --> Providers["Local deterministic agents\nOpenAI Responses\nGeneric HTTP LLM"]
  Load["Synthetic WebSocket load test"] --> WS
```

## Final Submission Status

Local implementation is complete against the saved spec and is checked by:

```bash
npm run preflight
npm run load-test:smoke
npm run load-test:target-artifact
npm run final-audit:local
npm run final-handoff
```

`npm run final-audit:local` validates the local package without external links. `npm run final-audit` validates the local package plus the final external links. The remaining submission-only items are:

- Add a GitHub `origin` remote and push this repository.
- Deploy the app to a public URL.
- Record the 90-second Loom using `docs/demo-script.md`.
- Run `npm run final-audit` with `LIVE_DEMO_URL`, `GITHUB_REPO_URL`, and `LOOM_URL`.
