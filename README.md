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

### Authentic red-team run (R2): two open-weight models, two roles

A second recorded run (2026-11-11) uses two open-weight models through hosted
Otari for different jobs, and keeps the verdict out of both models' hands:

| Role | Model | What it does |
| --- | --- | --- |
| Generate | Qwen3 32B (`alibaba/qwen3-32b`) | Rewrites each v2 contract case into one test variation (prompt injection, distractor, indirect phrasing). Its own labels are ignored. |
| Respond | GPT OSS 20B (`openai/gpt-oss-20b`) | Answers each variation as structured JSON with the unchanged v2 prompt. |
| Judge | `support-card-classification-v2` | Deterministic rules check each answer against the expectations of the original case, written before the run. No model judges. |

- 4 requests: 1 generator, 3 responder. Otari reported `Otari-Model:
  Qwen/Qwen3-32B` for the generator and `openai/gpt-oss-20b` for the
  responder, provider `deepinfra`, 1 attempt, `Otari-Fallback: false`. The run
  stops if Otari does not confirm the requested model for a role.
- All three answers met the contract: v2 decision `APPROVE`.
- Reported cost US$0.000224, equal to the four Otari usage rows and to the key
  budget delta.

What it does **not** show: only three variations in one run, so it is not a
robustness measure; the variation labelled prompt injection contains no
injected instruction, so **resistance to prompt injection is not
demonstrated**; Otari Web Fetch was not used (it is listed by `GET
/api/v1/tools` but priced at US$0.01 per call, equal to the run cap); no
fallback was requested or occurred.

Evidence:
[run record, redacted copy](evidence/redacted/redteam-2026-11-11T18-28-54-622Z.redacted.json)
(SHA-256 `6F26BA2AB1BB7D41D86BF0527ACC7C0688E47CC96B72FA5BB6EA21FC00E27D0F`),
[usage rows](evidence/authentic/redteam-2026-11-11T18-28-54-622Z.usage.json),
[run report](docs/redteam-run-01-report.txt),
[protocol](docs/redteam-protocol.txt). As with R1, the record is a **redacted
copy, not byte-identical to the original**; balances, limits and the exposure
setting were removed and the private original's SHA-256 is listed in
`publicRedaction.sourceSha256`. Code: `src/evaluation/redteam.ts`,
`scripts/redteam-run.ts`; the page loads `public/redteam-run-01-result.redacted.json`.

After R2, the red-team filter was tightened: a generated variation that negates
the seed intent (for example "I have not lost my card") is now discarded, so the
run ends `INCONCLUSIVE` instead of approving an answer to the wrong question.
This is a keyword heuristic for known cases, not full semantic understanding.

### Authentic Otari tools run (R3): Code Execution and Web Fetch

Two recorded calls (2026-11-12 UTC) add two checks around the evaluation:

| Step | Otari tool | What it does |
| --- | --- | --- |
| Re-check the verdicts | Code Execution, `POST /api/v1/code/execute` | Runs `scripts/contract_v2_check.py`, an independent standard-library Python re-implementation of the 8 v2 rules, in Otari's sandbox (20 s timeout, no persistent container). It re-judges the three real GPT OSS 20B answers from R2 and two answers that must fail. Its verdicts are compared with the TypeScript validator; any disagreement gives `INCONCLUSIVE`, never `APPROVE`. |
| Check contract provenance | Web Fetch, `POST /api/v1/fetch` | Fetches only `src/contracts/support-card.ts` from this public repository at commit `c2d9ae6`. The final URL must equal the requested one, the text must not be truncated, and its SHA-256 must equal the contract the validators use. The fetched text is treated as untrusted data and only hashed. |

- Code Execution: request `9346995f-7315-45f5-8e0c-662541cbdea4`, HTTP 200,
  return code 0. Python and TypeScript agree on all five answers (three passed,
  two failed on the same rules). Decision `APPROVE`.
- Web Fetch: request `9bbe3ee4-72e3-474e-ad22-2cf582c827a5`, HTTP 200, no
  redirect, `text/plain`, not truncated, SHA-256
  `D3DD493DFE7B244BD1EDF9CC328195F44E86D85C638F1EF6D48FB94636FEDDDF` matching
  the contract at `c2d9ae6`. Decision `APPROVE`.
- Cost US$0.02: two Otari usage rows of US$0.01, equal to the key budget deltas.

What it does **not** show: two validators written from the same contract
agreeing is not a formal proof of correctness; only five answers ran in the
sandbox, which ran a fixed verifier, not a model; the fetched file is this
project's own public contract, so it shows neither general browsing nor
resistance to prompt injection; no fallback was requested or occurred.

How it connects to the evaluation: both checks are operator-run steps
(`npm run otari-tool-run -- code`, then `-- fetch <code evidence>`), each
gated by `OTARI_LIVE_TOOLS_ENABLED=1` and an Otari budget preflight, sending one
request without retries. The re-check reads the recorded R2 answers as input;
the public page only displays the recorded results and makes no call.

Evidence: [Code Execution, redacted copy](public/otari-code-execution-01.redacted.json)
(SHA-256 `D93C9928C3001A867584036F42094786E665F7CC60853BF4E51FE9F423205013`),
[Web Fetch, redacted copy](public/otari-web-fetch-01.redacted.json)
(SHA-256 `6BFF0F07231362B71A0702667CCF976DEDFD5BC57954B4A284D4578D457DD688`).
Both are **redacted copies, not byte-identical to the originals**, with the same
fields removed as in R1 and R2. Code: `src/evaluation/otari-tools.ts`,
`src/otari/client.ts` (`executeOtariCode`, `fetchOtariPage`),
`scripts/otari-tool-run.ts`, tests in `tests/otari-tools.test.ts`.

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

The red-team run follows the same safeguards: `npm run redteam-run` (see
`docs/redteam-protocol.txt`) and `npm run redact-redteam-evidence`.

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
