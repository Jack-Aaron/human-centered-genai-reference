# Human-Centered Generative AI Reference Architecture

A domain-agnostic reference implementation of an end-to-end generative AI system that separates **subjective quality optimization** from **secure production serving**.

The original system operates in a specialized private content domain. The domain corpus, production identifiers, deployment credentials, and proprietary prompt/evaluation material are intentionally excluded from this repository. Synthetic examples are used throughout.

This public implementation preserves the engineering concepts: human-in-the-loop evaluation, noisy preference signals, candidate validation and deduplication, authoritative external-corpus checks, persistent state, cryptographic client authentication, replay protection, rate limiting, Slack request verification, automated tests, and hardened Linux deployment.

## Why this project exists

Calling an LLM is easy. The difficult problem is turning an ambiguous human quality standard into something a model can reliably optimize for, evaluating the results empirically, and then building a production system that can serve approved output safely.

The project therefore treats these as separate problems:

1. **Quality:** does a generated candidate satisfy domain-aware human evaluators?
2. **Novelty:** is the candidate genuinely new relative to an authoritative corpus?
3. **Serving:** can approved candidates be delivered safely under abuse, concurrency, and failure?

See [docs/AI_EVALUATION.md](docs/AI_EVALUATION.md) for the evaluation methodology.

## Architecture

```text
historical corpus + noisy preference signal
                |
                v
      qualitative / quantitative analysis
                |
                v
      latent quality criteria
                |
                v
 structured prompts + exemplars + constraints
                |
                v
        candidate generation
                |
                v
       human evaluation loop
                |
                v
        approved candidate queue
                |
                v
   +------------+-------------+
   |                          |
Slack signed request    Ed25519 client API
   |                          |
   +------------+-------------+
                |
                v
    global + per-client gates
                |
                v
       cached external corpus
                |
                v
 collision rejection / random selection
                |
                v
        atomic SQLite update
                |
                v
              output
```

The serving path does **not** require a live model call. This intentionally separates stochastic/expensive generation from deterministic production serving.

## Engineering highlights

- TypeScript / Node.js 20 / Express 5 backend
- SQLite persistence with migrations and atomic state transitions
- Random approved-candidate selection with external-corpus collision rejection
- Periodically refreshed, validated corpus snapshot with fail-closed serving behavior
- Ed25519 request signatures bound to method, path, timestamp, nonce, and SHA-256 body hash
- Persistent replay protection
- Independent per-client identities, revocation, daily quotas, and HTTP request ceilings
- Proof-of-possession self-registration that creates pending client identities only
- Separate Slack trust boundary using Slack HMAC request verification
- Strict body, method, path, content-type, and request-size validation
- CLI operations for queue management, client administration, registration approval, backups, and corpus refresh
- Structured HTTP telemetry that avoids logging authentication signatures or private keys
- systemd sandboxing examples for least-privilege Linux deployment
- Automated tests for the security, data-integrity, rate-limit, and serving primitives

## Stack

- **Language:** TypeScript
- **Runtime:** Node.js 20+
- **HTTP:** Express 5
- **Database:** SQLite via `better-sqlite3`
- **HTML parsing:** Cheerio
- **CLI:** Commander
- **Tests:** Vitest
- **Security:** Ed25519, SHA-256, HMAC-SHA256, cryptographic nonces
- **Operations:** Linux, systemd, Bash/CLI workflows, reverse-proxy/tunnel-friendly localhost binding

## Quick start

```bash
npm install
cp .env.example .env
npm run build
```

Create the database and a fresh external-corpus snapshot:

```bash
npm run cli -- init
npm run cli -- corpus-refresh --force
```

Load synthetic candidates:

```bash
npm run cli -- add --file data/sample-candidates.txt
npm run cli -- stats
```

Start the service:

```bash
npm start
```

The default listener is intentionally localhost-only:

```text
127.0.0.1:3000
```

## Authenticated API demo

Generate an Ed25519 keypair locally:

```bash
openssl genpkey -algorithm Ed25519 -out demo-private.pem
openssl pkey -in demo-private.pem -pubout -out demo-public.pem
chmod 600 demo-private.pem
```

Register proof-of-possession:

```bash
GENAI_KEY_ID=demo-client \
GENAI_PRIVATE_KEY_PATH=./demo-private.pem \
node examples/register-client.mjs
```

Registration creates a **pending** identity. Approve it from the administrative CLI:

```bash
npm run cli -- registration-list
npm run cli -- registration-approve demo-client --daily-cap 10
```

Then request one approved candidate:

```bash
GENAI_KEY_ID=demo-client \
GENAI_PRIVATE_KEY_PATH=./demo-private.pem \
node examples/signed-client.mjs
```

The client private key never needs to be copied to the server.

## External corpus validation

The sample configuration reads `data/sample-corpus.html`. A production deployment can instead point `EXTERNAL_CORPUS_URL` at an authoritative HTTP source.

The refresher:

- applies a timeout and maximum response size;
- rejects unexpectedly small/invalid corpora;
- normalizes ordinary typography and whitespace differences;
- writes snapshots atomically;
- allows forced recovery from a corrupt local snapshot;
- leaves serving fail-closed when a sufficiently fresh validated snapshot is unavailable.

This keeps **quality** and **novelty** as separate checks.

## Human-in-the-loop evaluation

The private project used human scores as the primary quality signal and explicitly analyzed disagreement between human and model judgments rather than treating model self-evaluation as ground truth.

A small synthetic analysis utility is included:

```bash
node scripts/analyze-evaluations.mjs data/evaluation-sample.csv
```

It reports mean scores, exact agreement, within-one-point agreement, and Pearson correlation.

## Security model

Authentication is not authorization to do everything.

An authenticated client receives one narrowly scoped capability: request one candidate subject to server-side limits. It cannot inspect the queue, select a candidate, reset counters, change configuration, or access administrative operations.

The API signs this canonical payload:

```text
<key-id>
<timestamp>
<nonce>
<method>
<path>
<SHA256-hex-of-exact-request-body>
```

See [SECURITY.md](SECURITY.md) and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Tests

```bash
npm test
```

Or run the complete build + test check:

```bash
npm run check
```

## Production deployment pattern

The recommended boundary is:

```text
internet
   |
reverse proxy / tunnel
   |
127.0.0.1 application listener
   |
dedicated unprivileged service account
   |
SQLite + validated snapshot
```

Example systemd units are provided in `deploy/`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Public adaptation boundary

This repository intentionally does **not** contain:

- the original domain corpus;
- real generated outputs from the private project;
- private evaluation exemplars or production prompts;
- production hostnames, client identities, Slack workspace identifiers, or credentials;
- production databases, backups, logs, or operator notes;
- Git history from the private implementation.

It is a clean-room public reference implementation of the architecture and engineering work.

## License

MIT. See [LICENSE](LICENSE).
