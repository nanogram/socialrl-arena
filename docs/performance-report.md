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
  "elapsedMs": 5100,
  "messagesSent": 1000,
  "reportsReady": 100,
  "socketsOpened": 300,
  "socketCloses": 300,
  "unexpectedSocketCloses": 0,
  "snapshots": 11411,
  "errors": 0,
  "messageThroughputPerSecond": 196.08,
  "reportThroughputPerSecond": 19.61,
  "firstTokenSamples": 960,
  "feedbackSamples": 100,
  "p50MessageAckMs": 56,
  "p95MessageAckMs": 111,
  "p50FirstTokenLatencyMs": 313,
  "p95FirstTokenLatencyMs": 371,
  "p50FeedbackAckMs": 1,
  "p95FeedbackAckMs": 7,
  "p50ReportLatencyMs": 1838,
  "p95ReportLatencyMs": 2885
}
```

## Interpretation

The demo target profile completed with zero WebSocket or report errors. All 300 WebSocket clients closed cleanly after the run. Every room generated a report, report throughput was 19.61 reports per second, p95 first-token latency was 371 ms, p95 feedback acknowledgement latency was 7 ms, and p95 report latency was 2.885 seconds in local memory-backed mode.

This is not a production benchmark. It is a demo-level verification that the realtime loop, routing loop, feedback/report loop, and WebSocket fanout can handle the target scenario locally.
