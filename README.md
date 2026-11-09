# Fallback Contract

Fallback Contract is a deterministic model-replacement gate. It evaluates
model outputs against a versioned functional contract instead of treating an
HTTP success as proof of compatibility.

## Public demo

The public-safe build is a **read-only recorded demo**. It loads the verified
Mission 10 evidence from `public/mission-10-authentic-result.json` and does
not make inference requests. The page labels the run `RECORDED LIVE RUN` and
shows the authentic models, request IDs, tokens, reported cost, raw outputs,
rules and deterministic `REJECT` decision.

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

## Evidence and limitations

- Authentic evidence is preserved in `docs/mission-10-authentic-result.json`.
- The Worker/workerd path to Otari remains HTTP 403.
- Recorded evidence is not a new real-time request.
- No request accepts visitor-supplied prompts, models or code.
- `OTARI_API_KEY` and bearer tokens remain server-side.

## History

The development branch is
`hackathon/mozilla-developers-wilding-2026`. The first Otari integration
commit is `d5027f7` (with the original scaffold at `57d1477`).

## License

MIT; see `LICENSE`.
