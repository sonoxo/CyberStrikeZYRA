# BLACK HOUSE — Authorized Adversary Simulation Layer

CyberStrikeZYRA is the Black House purple-team / adversary-emulation engine for controlled environments.

## Collective model

The architecture represents **7,000,000 logical agent identities** without attempting to run seven million operating-system processes, containers, or network clients.

- Logical collective: `7,000,000`
- Shard size: `1,000` logical agents
- Logical shards: `7,000`
- Maximum concurrently scheduled shards: `256`
- Runtime model: virtualized / queue-driven
- Default scope: loopback, RFC1918 private IPv4, `.localhost`, and `.test`
- Required controls: authorization token, expiration, target scope, global kill switch, audit telemetry

## Mission hierarchy

```text
BLACK HOUSE CONTROL PLANE
        |
        +-- Authorization / Scope Gate
        +-- Mission Commander
        |      +-- Sector planners
        |      +-- Cohort schedulers
        |      +-- Shard workers
        |      +-- Logical agents
        |
        +-- Telemetry / Evidence Bus
        +-- Detection Validation
        +-- Kill Switch / Circuit Breakers
```

The fleet is designed for authorized exercises such as asset inventory, security-control validation, detection validation, and adversary emulation inside isolated or explicitly controlled lab ranges.

## Safety invariants

1. No mission begins without a non-empty authorization identifier and an unexpired authorization window.
2. The built-in policy gate rejects public Internet targets.
3. A global kill switch prevents planning or scheduling.
4. The 7M figure is a logical capacity target; actual active work is bounded by concurrency controls.
5. Operators should integrate telemetry with the Black House evidence and detection layers before enabling additional execution adapters.

## Code

The first implementation lives in:

- `packages/cyberstrike/src/collective/policy.ts`
- `packages/cyberstrike/src/collective/index.ts`
- `packages/cyberstrike/src/collective/index.test.ts`

The planner intentionally produces bounded execution batches rather than autonomous uncontrolled deployment.
