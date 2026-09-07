# CyberStrike StrikeGraph

StrikeGraph is the defensive ontology and decision layer for `sonoxo/CyberStrikeZYRA`.

It converts disconnected scanner/MCP results into one governed graph that can answer four operational questions:

1. **What do we have?** — assets, identities, services, controls and data sources.
2. **What is exposed?** — vulnerabilities and asset-specific exposures.
3. **What can detect or mitigate it?** — detections, evidence and countermeasures.
4. **What should happen next?** — ranked defensive recommendations, simulations, and explicitly approved actions.

## Runtime architecture

```text
GitHub Security ─┐
CVE / KEV ───────┤
OSINT ───────────┤
Cloud Audit ─────┤
DNS Security ────┤
Supply Chain ────┼──> normalization ──> STRIKEGRAPH ──> validate/query/prioritize
MCP Scanner ─────┘                           │
                                            ├─ detections
                                            ├─ countermeasures
                                            ├─ incidents
                                            ├─ evidence
                                            └─ governed actions
```

The configured CyberStrike MCP sources remain independent collectors. StrikeGraph is the semantic layer above them; it does not replace the collectors.

## Canonical entity types

`Component`, `DataSource`, `Asset`, `Identity`, `Service`, `Vulnerability`, `Exposure`, `Detection`, `Alert`, `Incident`, `Countermeasure`, `Evidence`, `Control`, `Simulation`, and `Action`.

## Canonical relationships

`FEEDS`, `RUNS_ON`, `USES_IDENTITY`, `AFFECTS`, `DERIVED_FROM`, `DETECTED_BY`, `TRIGGERS`, `PART_OF`, `MITIGATED_BY`, `SUPPORTED_BY`, `APPLIES_TO`, `SIMULATES`, `RECOMMENDS`, `RESPONDS_TO`, and `GOVERNED_BY`.

## Native tools

The project tool loader automatically exposes exports from `.cyberstrike/tool/strikegraph.ts` as:

- `strikegraph_validate` — schema, referential-integrity and governance validation.
- `strikegraph_query` — entity/relation search and one-hop neighborhood inspection.
- `strikegraph_mutate` — validation-first mutation; dry-run unless `commit=true`.
- `strikegraph_prioritize` — defensive exposure ranking from 0-100.

### Prioritization formula

```text
+30 known exploited / KEV
+20 internet exposed
+20 exploitability
+20 asset criticality
+10 privilege impact
-10 detection coverage
-25 mitigation present
= clamp 0..100
```

Priority bands: `P0 >= 80`, `P1 >= 60`, `P2 >= 40`, otherwise `P3`.

This is a decision-support score, not a replacement for analyst judgment.

## Governance boundary

StrikeGraph is deliberately defense-first. `Action.mode` is restricted to:

- `recommend` — advisory only.
- `simulate` — execute only inside a lab/digital twin.
- `approved` — records an externally authorized action.

The graph validator rejects other autonomous action modes. Real-world disruptive operations are not a StrikeGraph capability.

## Mutation workflow

```text
VALIDATE -> QUERY -> DRY RUN -> REVIEW -> COMMIT -> VALIDATE
```

Use canonical stable IDs such as:

- `asset:<environment>:<name>`
- `identity:<provider>:<name>`
- `vuln:CVE-YYYY-NNNN`
- `exposure:<asset>:<vuln>`
- `detection:<platform>:<rule>`
- `incident:<id>`
- `countermeasure:<framework>:<id>`
- `evidence:<source>:<id>`

## Next build waves

1. **ATT&CK/D3FEND mapping** — Technique and defensive-countermeasure normalization.
2. **Sigma detection-as-code** — Detection entities compiled to target SIEMs.
3. **Ingestion adapters** — normalize MCP outputs into graph mutations.
4. **Digital twin** — Simulation entities and replayable synthetic incidents.
5. **Governed response** — approval-gated SOAR actions with immutable evidence chains.
