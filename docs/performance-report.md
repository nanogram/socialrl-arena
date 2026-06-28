# Performance Report

## Target Profile

The spec asks the demo to simulate:

- 100 rooms
- 300 human users
- 300 AI agents
- 1,000 messages over a short window

The local target run used deterministic local agents and in-memory storage to isolate WebSocket fanout, orchestration, routing, report generation, and feedback/report event flow from disk persistence overhead.

Command:

```bash
npm run start:memory
npm run load-test:target
```

For the latest run below, the memory-backed server was started on port 3100 so it would not disturb the active local demo server:

```bash
PORT=3100 SOCIALRL_STORAGE=memory node src/server.js
LOAD_TEST_URL=ws://localhost:3100 npm run load-test:target
```

## Latest Measured Run

Date: 2026-06-28

```json
{
  "targetUrl": "ws://localhost:3100",
  "roomCount": 100,
  "usersPerRoom": 3,
  "messagesPerRoom": 10,
  "aiAgentsSimulated": 300,
  "elapsedMs": 5436,
  "messagesSent": 1000,
  "reportsReady": 100,
  "socketsOpened": 300,
  "socketCloses": 300,
  "unexpectedSocketCloses": 0,
  "snapshots": 11634,
  "errors": 0,
  "messageThroughputPerSecond": 183.96,
  "reportThroughputPerSecond": 18.4,
  "firstTokenSamples": 999,
  "feedbackSamples": 100,
  "p50MessageAckMs": 54,
  "p95MessageAckMs": 139,
  "p50FirstTokenLatencyMs": 276,
  "p95FirstTokenLatencyMs": 385,
  "p50FeedbackAckMs": 5,
  "p95FeedbackAckMs": 56,
  "p50ReportLatencyMs": 1460,
  "p95ReportLatencyMs": 2491
}
```

## Interpretation

The demo target profile completed with zero WebSocket or report errors. It simulated 300 AI agents across 100 rooms, and all 300 WebSocket clients closed cleanly after the run. Every room generated a report, report throughput was 18.4 reports per second, p95 first-token latency was 385 ms, p95 feedback acknowledgement latency was 56 ms, and p95 report latency was 2.491 seconds in local memory-backed mode.

This is not a production benchmark. It is a demo-level verification that the realtime loop, routing loop, feedback/report loop, and WebSocket fanout can handle the target scenario locally. The load-test script now exits non-zero if report generation, first-token sampling, feedback acknowledgement sampling, or clean socket closure evidence is missing.
