# Architecture

## Separation of concerns

The system deliberately separates four responsibilities:

1. **Generation/evaluation** — stochastic experimentation and human quality review.
2. **Candidate storage** — a finite queue of approved, not-yet-served outputs.
3. **External novelty validation** — an authoritative corpus independent of local queue history.
4. **Serving** — deterministic, rate-limited, authenticated delivery.

This separation prevents public traffic from directly causing expensive model inference and makes production behavior auditable.

## Serving flow

```text
request
  |
  v
authenticate / validate
  |
  v
cheap request-rate ceiling
  |
  v
persistent replay claim
  |
  v
preflight global + client gates
  |
  v
load validated cached external corpus
  |
  v
atomic SQLite transaction
  |-- re-check gates
  |-- randomly select approved candidate
  |-- reject collisions and continue
  |-- mark selected candidate shown
  |-- increment global/client counters
  '-- record successful request
  |
  v
response
```

## Why the gates are checked twice

The preflight avoids unnecessary downstream work when a request is obviously blocked. The transaction checks the same invariants again before changing state. The second check is authoritative.

This protects against concurrent requests consuming multiple candidates inside the same cooldown/quota window.

## Database responsibilities

SQLite stores local application state only:

- approved candidate queue;
- shown/rejected history;
- global cooldown and daily state;
- API client public keys and quotas;
- replay nonces;
- pending client registrations;
- request outcome metadata.

The external authoritative corpus is **not** reproduced as a competing canonical database. A validated snapshot is an operational cache used for pre-serve collision checks.

## External corpus snapshot

Serving should not synchronously depend on an arbitrary external HTTP request. Instead, a timer refreshes a local validated snapshot.

Refresh requirements include:

- bounded response size;
- bounded latency;
- minimum expected entry count;
- normalization and deduplication;
- atomic snapshot replacement;
- last-known-good preservation;
- explicit forced recovery from a corrupt local snapshot.

Serving fails closed when the snapshot is absent, invalid, or too old.

## Trust boundaries

### Slack endpoint

Slack authentication is based on Slack's HMAC signature and timestamp scheme. Slack user/channel fields remain ordinary request data, not administrative credentials.

### Client API

Each API integration has an independent Ed25519 identity. Possession of a private key proves client identity but grants only the narrowly scoped `POST /api/generate` capability.

### Administration

Administrative operations stay out of public routes and are performed through the local/server CLI.
