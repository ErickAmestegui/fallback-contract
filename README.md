# Fallback Contract

Fallback Contract is a deterministic model-replacement gate. It evaluates
model outputs against a versioned functional contract instead of treating an
HTTP success as proof of compatibility.

## Public demo

Demo: https://fallback-contract.netlify.app/

The public-safe build is a **read-only recorded demo**. It loads the verified
Mission 10 evidence from `public/mission-10-authentic-result.json` and does
not make inference requests. The page labels the run `RECORDED LIVE RUN` and
shows the authentic models, request IDs, tokens, reported cost, raw outputs,
rules and deterministic `REJECT` decision.

### Authentic Otari routing run (v2)

The demo also shows one recorded run against a real Otari routing policy,
`fc-failover` (primary `deepinfra:openai/gpt-oss-20b`, `on_failure`
`bedrock:qwen.qwen3-32b-v1:0`), made on 2026-11-11 from the private backend:

- 6 requests: 3 to `openai/gpt-oss-20b` directly, 3 to `fc-failover`.
- Otari served every policy request with the primary: `Otari-Provider:
  deepinfra`, `Otari-Model: openai/gpt-oss-20b`, `Otari-Attempt-Count: 1`,
  `Otari-Fallback: false`. The response body kept the policy name.
- **No fallback occurred.** The `on_failure` path was not exercised and no
  failure was induced.
- v2 decision `APPROVE`. The reference was served by the same provider and
  model, so this is a consistency check of the policy path, not a
  cross-model comparison.
- Reported cost US$0.000098, equal to the key budget delta.

Evidence:
[run record, redacted copy](evidence/redacted/v2-routing-2026-11-11T13-18-59-492Z.redacted.json),
[usage rows, unmodified](evidence/authentic/v2-routing-2026-11-11T13-18-59-492Z.usage.json),
[run report, redacted copy, with SHA-256](docs/routing-run-01-report.redacted.txt).
The run record is a **redacted copy, not byte-identical to the original**: the
key's remaining balances, monthly limit and local exposure setting were removed
(`publicRedaction.removedFields` lists them). Calls, request IDs, Otari headers,
outputs and costs are unchanged. The original record and the post-run budget
reading are kept privately; their SHA-256 values are in the report. The page
loads `public/routing-run-01-result.redacted.json` and
`public/routing-run-01-usage.json` and shows the SHA-256 it computes.
Simulated fixtures are labelled `LOCAL TEST / DEMO`; the Mission 10 run is
labelled as the historical v1 experiment.

The public Netlify configuration publishes only `dist/client`. The inference
function and private Node backend are intentionally outside the configured
Netlify functions directory. Do not enable public inference without
authentication, rate limits and an explicit budget review.

## Local development

```bash
npm install
npm run dev
```

To preview the exact static demo served by the private local server:

```bash
npm run build
npm run node-backend
# open http://127.0.0.1:8788/
```

The Node backend can perform authenticated comparisons only when explicitly
run with `OTARI_API_KEY`; the public demo never calls it. The private
deployment candidate is in `private/functions/compare.ts` and is not included
in the Netlify publication path.

## Verification

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Structured v2 adapter

The recovery branch contains an offline-only v2 adapter in
`src/evaluation/v2-adapter.ts`. It accepts one response record per configured
case, validates the structured `actionId` contract, and preserves
`requestedModel`, `effectiveModel`, and `requestId` when supplied. Offline
fixtures are marked `local-fixture`; they are not Otari evidence.

## Otari routing/fallback (v2, private backend only)

`src/evaluation/v2-authentic-run.ts` sends the v2 cases to a reference model
and to an Otari failover policy (`select` default + `on_failure`) created in
the Otari dashboard. The served model is read from Otari's `Otari-Provider`
and `Otari-Model` headers, never from the body `model`, which keeps the policy
name. `Otari-Attempt-Count`, `Otari-Fallback` and `Otari-Request-ID` are
recorded per case. Unknown targets, missing or inconsistent routing metadata
and technical failures are `INCONCLUSIVE`.

No completion is sent unless `GET /api/v1/key/budget` reports an enforced
dollar ceiling whose remaining balance is between the run cap and the allowed
exposure. The run is sequential, has no retries and stops on budget, rate
limit, timeout or missing cost.

```bash
OTARI_API_KEY=... OTARI_LIVE_ROUTING_ENABLED=1 \
OTARI_ROUTING_POLICY=fc-failover \
OTARI_ROUTING_PRIMARY=provider:model OTARI_ROUTING_ON_FAILURE=provider:model \
OTARI_RUN_MAX_COST_USD=0.01 OTARI_MAX_EXPOSURE_USD=0.10 \
npm run node-backend
# POST http://127.0.0.1:8788/api/compare-v2-routing
npm run verify-routing-usage -- evidence/authentic/v2-routing-<timestamp>.json
```

Authentic runs are written to `evidence/authentic/` and never overwritten.
`npm run redact-routing-evidence -- <run.json> <output.json>` writes a public
copy without key balances or limits. See
`docs/routing-run-01-report.redacted.txt` for the one authentic run.

## Evidence and limitations

- Authentic evidence is preserved in `docs/mission-10-authentic-result.json`.
- The Worker/workerd path to Otari remains HTTP 403.
- Recorded evidence is not a new real-time request.
- No request accepts visitor-supplied prompts, models or code.
- `OTARI_API_KEY` and bearer tokens remain server-side.

## History

The development branch is
`hackathon/mozilla-developers-wilding-2026`. The first Otari integration
commit is [`f5d35e3ee4c06c0a2b94de73b7af32b7c9d52c9f`](https://github.com/ErickAmestegui/fallback-contract/commit/f5d35e3ee4c06c0a2b94de73b7af32b7c9d52c9f)
(with the original scaffold at [`57d1477`](https://github.com/ErickAmestegui/fallback-contract/commit/57d1477)).

## License

MIT; see `LICENSE`.
