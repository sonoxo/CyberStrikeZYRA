# CyberStrike Target Shield

Target Shield is a scope-enforced defensive target-management layer for CyberStrike. A **target** here is an owned/authorized asset, service, repository, lab system, or threat indicator — never a person.

## Defensive lifecycle

`DISCOVER → VERIFY → PRIORITIZE → AUTHORIZE → VALIDATE → CONTAIN → RECOVER → LEARN`

Target Shield separates authorization from execution. It scores risk, creates defensive response plans, checks time-bounded authorization, records audit events, and only permits active validation when the target locator matches the approved scope.

## Ontology = data-protection control plane

The XUNIA ontology exists to protect data, not merely describe infrastructure. `packages/target-defense/data-protection.json` defines protected data classes, owners, purposes, residency, retention, local-only processing rules, approved processors, egress policy, and sensitive-state requirements. `ontology.mjs sync` enforces those rules during RedButton preflight.

Key data controls:

- default egress is **DENY**;
- `CONFIDENTIAL` and `RESTRICTED` data are local-processing-only unless explicitly reclassified and approved;
- sensitive Target Shield state and ontology files are forced to private local permissions (`0600` files / `0700` state directory);
- required host encryption is checked where the platform exposes it;
- secret-bearing fields such as passwords, tokens, API keys, refresh tokens, and private keys are forbidden from ontology serialization;
- every allowed data flow must identify a protected DataAsset, processor, purpose, and governing DataProtectionPolicy;
- a denied data flow or protection-policy violation returns **NO-GO** and stops RedButton preflight.

Run the data guard directly:

```bash
RedButton ontology
```

A healthy result includes:

```text
🔐 data protection: ENFORCED
"valid": true
```

## Safety invariants

1. Active validation is **NO-GO by default**.
2. A current authorization lease is required for scanning/probing/containment actions.
3. The target locator must match the explicit approved scope.
4. Authorization expires automatically (maximum lease: 168 hours).
5. Every authorization decision is written to `.cyberstrike/target-shield.json`.
6. Response actions are defensive: observe, preserve evidence, block, isolate, rotate credentials, disable an owned service, restore, or internal/lab sinkholing.
7. Automatic CyberStrike launch is restricted to `local` and `lab` targets.
8. Launch fails closed if CyberStrike/Playwright is incomplete or a local target is not listening.
9. Ontology data-protection validation must pass before the RedButton stack opens CyberStrike.
10. There is no hack-back or third-party retaliation path.

## Quick start (Node; no Bun required)

Run these commands from the **CyberStrikeZYRA repository root**:

```bash
node packages/target-defense/target-shield.mjs init

node packages/target-defense/target-shield.mjs add \
  --name xunia-local \
  --kind service \
  --locator localhost:3000 \
  --owner xunia \
  --env local

node packages/target-defense/target-shield.mjs authorize xunia-local \
  --approved-by doug \
  --reason "local defensive validation" \
  --scope localhost:3000 \
  --hours 8

node packages/target-defense/target-shield.mjs check xunia-local --action scan
node packages/target-defense/target-shield.mjs scope xunia-local
```

## Runtime doctor

Check CyberStrike and its browser runtime before launch:

```bash
node packages/target-defense/target-shield.mjs doctor
```

If Playwright/Chromium is missing, install it into CyberStrike's runtime with the explicit repair option:

```bash
node packages/target-defense/target-shield.mjs doctor --fix-browser
```

`CYBERSTRIKE_HOME` can override the default runtime directory (`~/.local/share/cyberstrike`).

## Launch an authorized local/lab web target

The installed CyberStrike CLI does **not** expose a top-level `--scope` flag. Its supported web-target entry point is `cyberstrike hackbrowser <target>`.

Target Shield performs the authorization check, confirms the local endpoint is listening, confirms the browser runtime is present, and only then launches the approved local/lab target:

```bash
node packages/target-defense/target-shield.mjs launch xunia-local
```

For `localhost:3000`, Target Shield resolves the web target to `http://localhost:3000` and invokes:

```text
cyberstrike hackbrowser http://localhost:3000
```

If nothing is listening on port 3000, launch returns `NO-GO` instead of sending CyberStrike into a dead endpoint. The decision is recorded in the audit database.

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
