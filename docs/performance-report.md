# Performance Report

## Target Profile

The spec asks the demo to simulate:

- 100 rooms
- 300 human users
- 300 AI agents
- 1,000 messages over a short window

The local target run used deterministic local agents and in-memory storage to isolate WebSocket fanout, orchestration, routing, report generation, and feedback/report event flow from disk persistence overhead. Shape reports also include active-room and rooms-tracked context captured from the server worker at report-generation time.

Command:

```bash
npm run start:memory
npm run load-test:target
```

To generate the final machine-readable evidence artifact, run:

```bash
npm run load-test:target-artifact
```

This starts a memory-backed server on port 3100, runs the target profile, writes `demo-artifacts/target-load-latest.json`, and stops the temporary server.

For the latest run below, the memory-backed server was started on port 3100 so it would not disturb the active local demo server:

```bash
PORT=3100 SOCIALRL_STORAGE=memory node src/server.js
LOAD_TEST_URL=ws://localhost:3100 npm run load-test:target
```

## Latest Measured Run

Date: 2026-06-28

```json
{
  "generatedAt": "2026-06-28T10:04:32.980Z",
  "targetUrl": "ws://localhost:3100",
  "scenarioId": "weekend_trip",
  "roomCount": 100,
  "usersPerRoom": 3,
  "messagesPerRoom": 10,
  "aiAgentsSimulated": 300,
  "elapsedMs": 7521,
  "messagesSent": 1000,
  "reportsReady": 100,
  "socketsOpened": 300,
  "socketCloses": 300,
  "unexpectedSocketCloses": 0,
  "snapshots": 11593,
  "errors": 0,
  "messageThroughputPerSecond": 132.96,
  "reportThroughputPerSecond": 13.3,
  "firstTokenSamples": 984,
  "feedbackSamples": 100,
  "p50MessageAckMs": 142,
  "p95MessageAckMs": 273,
  "p50FirstTokenLatencyMs": 406,
  "p95FirstTokenLatencyMs": 489,
  "p50FeedbackAckMs": 6,
  "p95FeedbackAckMs": 81,
  "p50ReportLatencyMs": 2610,
  "p95ReportLatencyMs": 3507,
  "passed": true
}
```

## Interpretation

The demo target profile completed with zero WebSocket or report errors. It simulated 300 AI agents across 100 rooms, and all 300 WebSocket clients closed cleanly after the run. Every room generated a report, report throughput was 13.3 reports per second, p95 first-token latency was 489 ms, p95 feedback acknowledgement latency was 81 ms, and p95 report latency was 3.507 seconds in local memory-backed mode.

This is not a production benchmark. It is a demo-level verification that the realtime loop, routing loop, feedback/report loop, and WebSocket fanout can handle the target scenario locally. The load-test script now exits non-zero if report generation, first-token sampling, feedback acknowledgement sampling, or clean socket closure evidence is missing, and the target-artifact command writes the latest result to `demo-artifacts/target-load-latest.json` for final audit.
