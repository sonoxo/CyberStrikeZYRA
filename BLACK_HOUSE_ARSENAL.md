# BLACK HOUSE ARSENAL

Black House Arsenal is the adversary-emulation library for CyberStrikeZYRA.

It is intentionally designed for authorized cyber ranges, purple-team exercises, detection engineering, tabletop exercises, and digital-twin validation. The modules are inert: they emit deterministic telemetry and do not perform network I/O, credential attacks, exploitation, data exfiltration, or destructive file operations.

## Weapons

| ID | Role | Emits |
| --- | --- | --- |
| `ghost-scan` | Reconnaissance detector exercise | Synthetic service-discovery observations |
| `velvet-hammer` | Identity-defense exercise | Synthetic authentication failures and lockout markers |
| `glass-needle` | Application-security exercise | Synthetic injection-boundary probe markers |
| `smoke-exfil` | Egress-monitoring exercise | Synthetic outbound-transfer telemetry to `.test` collectors |
| `deadbolt` | Ransomware-defense exercise | Synthetic rename, entropy, and recovery-note canary markers |

## Safety invariants

Every generated event declares:

- `effect: telemetry-only`
- `network: false`
- `destructive: false`

The arsenal also inherits Black House target restrictions and accepts only localhost, RFC1918 private IPv4 ranges, and reserved `.test` targets. A global stop state prevents generation entirely.

## Example

```ts
import { fire } from "./src/arsenal"

const events = fire("ghost-scan", {
  target: "10.0.0.10",
  intensity: 5,
  seed: 42,
})
```

This produces synthetic telemetry for a detector or SIEM test harness. It does not contact `10.0.0.10`.

## Collective integration

The 7,000,000-agent Black House collective is a logical scheduling model. Arsenal events are designed to be assigned to those logical identities/shards so large exercises can be modeled without spawning an uncontrolled botnet or millions of network clients.

Recommended execution path:

`mission -> scope gate -> collective planner -> shard scheduler -> arsenal event generator -> telemetry bus -> detection scoring -> evidence store`
