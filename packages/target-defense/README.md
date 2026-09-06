# CyberStrike Target Shield

Target Shield is a scope-enforced defensive target-management layer for CyberStrike. A **target** here is an owned/authorized asset, service, repository, lab system, or threat indicator — never a person.

## Defensive lifecycle

`DISCOVER → VERIFY → PRIORITIZE → AUTHORIZE → VALIDATE → CONTAIN → RECOVER → LEARN`

The package intentionally separates **decisioning** from **execution**. It scores risk, creates a defensive response plan, checks authorization, and exports only the approved `--scope` arguments for CyberStrike.

## Safety invariants

1. Active validation is **NO-GO by default**.
2. A current authorization lease is required for scanning/probing/containment actions.
3. The target locator must match the explicit approved scope.
4. Authorization expires automatically (maximum lease: 168 hours).
5. Every authorization decision is written to `.cyberstrike/target-shield.json`.
6. Response actions are defensive: observe, preserve evidence, block, isolate, rotate credentials, disable an owned service, restore, or internal/lab sinkholing.
7. There is no hack-back or third-party retaliation path.

## Quick start

```bash
bun --cwd packages/target-defense start init

bun --cwd packages/target-defense start add \
  --name xunia-staging \
  --kind domain \
  --locator staging.example.internal \
  --owner xunia \
  --env staging \
  --criticality 4 --exposure 3 --confidence 4 --impact 4

bun --cwd packages/target-defense start authorize xunia-staging \
  --approved-by security-owner \
  --reason "scheduled defensive validation" \
  --scope staging.example.internal \
  --hours 8

bun --cwd packages/target-defense start score xunia-staging
bun --cwd packages/target-defense start plan xunia-staging
bun --cwd packages/target-defense start check xunia-staging --action scan
bun --cwd packages/target-defense start scope xunia-staging
```

The final command prints the authorization-constrained CyberStrike scope, for example:

```text
cyberstrike --scope "staging.example.internal"
```

Target Shield does **not** automatically execute the generated command. This keeps authorization and operator intent explicit.

## Priority model

Risk is scored 0–100 from four operator-controlled dimensions:

- criticality: 30%
- exposure: 25%
- confidence: 20%
- impact: 25%

Tiers: `P1 >= 80`, `P2 >= 60`, `P3 >= 35`, otherwise `P4`.

## Reference

Design reference supplied by the project owner: https://www.youtube.com/watch?v=jTgAe_I3Px0

The implementation uses a protection-oriented adaptation and does not depend on unverifiable claims from the reference video.
