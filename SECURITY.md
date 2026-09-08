# Security

This reference implementation exposes two independent public trust boundaries:

```text
POST /slack/
POST /api/generate
```

An optional third endpoint permits proof-of-possession registration of **pending** API clients:

```text
POST /api/register
```

Pending registration never grants serving access until an administrator explicitly approves it.

## Authenticated API

Each client owns an Ed25519 keypair. The private key remains with the client; the service stores only the corresponding public key.

Required request headers:

```text
X-GenAI-Key-Id
X-GenAI-Timestamp
X-GenAI-Nonce
X-GenAI-Signature
```

The signature covers:

```text
<key-id>
<timestamp>
<nonce>
<method>
<path>
<SHA256-hex-of-exact-request-body>
```

This binds a signature to the exact client identity, time window, nonce, HTTP method, route, and body.

## Replay protection

Accepted API nonces are persisted in SQLite. Reusing the same nonce for the same client returns HTTP `409 replay`.

The timestamp provides a short validity window; the nonce protects against reuse inside that window.

## Abuse controls

The implementation layers controls instead of treating authentication as trust:

- request-size limit;
- strict method/path/body validation;
- short-lived signed requests;
- replay prevention;
- authenticated per-client HTTP request ceilings;
- per-client successful-request daily caps;
- global cooldown;
- global successful-request daily cap;
- per-client enable/revoke state;
- global kill switch.

Malformed, unauthorized, replayed, and HTTP-rate-limited traffic does not consume a successful candidate allowance.

## Slack

The Slack route uses Slack signing-secret verification over the exact raw request body and rejects stale timestamps. Optional workspace and slash-command allowlists can be configured.

Slack identity is not reused as API authentication and is never an administrative boundary.

## Logging

Structured access logs intentionally avoid:

- request signatures;
- private keys;
- Slack signing secrets;
- full request bodies;
- environment secrets.

An authenticated client key ID is logged only after successful cryptographic authentication.

## Secrets

Never commit:

- `.env`;
- private keys;
- signing secrets;
- production databases;
- backups;
- live signed request captures.

The included `.gitignore` excludes the common local forms of these artifacts.

## Deployment

Bind the Node application to localhost and place an HTTPS reverse proxy or outbound tunnel in front of it. Run the service as a dedicated unprivileged account. Example systemd sandboxing is provided in `deploy/`.

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
