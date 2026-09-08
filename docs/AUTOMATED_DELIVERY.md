# Automated Delivery

## Purpose

The core service ends at authenticated, rate-limited delivery of one approved candidate. Some deployments need an additional step: placing that output into a third-party interface that does not provide a suitable API or where the desired identity is an ordinary human account.

That downstream step should be treated as a separate trust boundary and reliability problem. It is not part of model generation and it should not weaken the serving API.

A durable delivery agent can bridge the two systems while preserving these properties:

- no output is lost after it is fetched;
- an ambiguous failure does not cause blind duplicate delivery;
- successful delivery is verified against the external system;
- browser credentials or session state are isolated from the serving process;
- expired authentication requires human reauthentication rather than credential bypass;
- scheduling and browser lifetime are independent from model generation.

## Reference flow

```text
scheduled opportunity
        |
        v
check external-session health
        |
        v
reconcile any durable pending item
        |
        +-- already delivered? --> record confirmation --> clear pending
        |
        +-- ambiguous? ---------> stop and require safe retry/review
        |
        v
request one item from authenticated API
        |
        v
atomically persist exact pending output
        |
        v
mark delivery attempt durable
        |
        v
submit through external UI
        |
        v
verify exact output + expected sender/target
        |
        v
record external confirmation identifier
        |
        v
clear pending
```

The critical transaction boundary is between **fetch** and **delivery**: the exact output must reach durable local storage before any external send is attempted.

## State model

A minimal pending record can contain:

```json
{
  "version": 1,
  "job_id": "2026-01-15-03-a1b2c3d4",
  "status": "sending",
  "text": "Synthetic candidate text",
  "fetched_at_ms": 1768471200000,
  "attempted_at_ms": 1768471200500
}
```

A confirmation history record can contain:

```json
{
  "job_id": "2026-01-15-03-a1b2c3d4",
  "text": "Synthetic candidate text",
  "confirmed_at_ms": 1768471202000,
  "external_message_id": "example-message-123",
  "external_target_id": "example-channel",
  "external_sender_id": "example-user",
  "confirmation_source": "live-send"
}
```

The example in [`examples/durable-delivery-state.mjs`](../examples/durable-delivery-state.mjs) implements crash-safe atomic JSON persistence using only Node.js core modules.

## Crash reconciliation

The most dangerous interval is:

```text
external system accepted the send
        |
        X  process crashes here
        |
local confirmation was not recorded
```

On restart, a naive agent might submit the same content again. Instead, a pending record whose status is `sending` should trigger reconciliation before any new send:

1. open the exact configured destination;
2. inspect a bounded recent history window;
3. search for the exact pending output;
4. require the expected stable sender identity and target identity;
5. require an external timestamp/message identifier consistent with the attempt;
6. if found, record a recovered confirmation and clear pending;
7. if not found and the result remains ambiguous, refuse blind automatic reposting.

Display names are weak identifiers. Prefer stable user/account IDs exposed by the external system when available.

## Browser-session isolation

When browser automation is necessary, keep it outside the serving service:

```text
serving account
  - database
  - API public client metadata
  - corpus snapshot

separate delivery account
  - API client private key
  - browser executable
  - persistent browser profile
  - pending/history state
```

The delivery account should not be able to read the production database, server signing secrets, backups, or administrative configuration.

A persistent browser profile may preserve an ordinary authenticated session across browser launches. It should be treated as sensitive credential material even if it contains no plaintext password.

Do not automate around CAPTCHA, MFA, security challenges, or forced reauthentication. When the session expires, stop delivery and ask a human to authenticate the same profile normally.

## Ephemeral browser lifecycle

A resource-efficient agent does not need to keep a browser running continuously:

```text
scheduler sleeps
   |
posting time arrives
   |
launch browser
   |
reconcile / send / verify
   |
close browser
   |
scheduler sleeps
```

This reduces memory consumption and the amount of time a browser process is exposed to untrusted web content.

Use the browser's normal sandbox. Do not add `--no-sandbox` merely to make automation easier. If systemd hardening conflicts with the browser sandbox, validate the required namespace behavior on the target distribution rather than disabling browser security globally.

## Random scheduling

If delivery times are intentionally randomized, generate them with a cryptographically secure random source and persist the schedule before execution. Persistence makes behavior auditable and prevents a service restart from silently generating additional opportunities.

The authoritative API quota remains the final limit. The scheduler should not assume that a scheduled opportunity guarantees a successful pull.

A useful pattern is:

```text
one persisted schedule per quota day
  - job id
  - scheduled timestamp
  - status: pending | running | done | skipped
  - completion timestamp
  - result
```

On scheduler restart, a `running` job should be reconciled against durable delivery history before it is executed again.

## Authentication-expiry alerts

Authentication failure is operationally different from a transient network error. A delivery agent should:

- classify login/reauthentication state explicitly;
- preserve any already-fetched pending output;
- avoid fetching another output while delivery is blocked;
- send a minimal alert that does not contain credentials or session data;
- deduplicate repeated alerts;
- clear the alert state after successful authentication is restored.

## Failure policy

| Failure | Safe behavior |
| --- | --- |
| API request fails before an output is returned | Retry later; no pending item exists |
| Output fetched, local persistence fails | Do not attempt external delivery |
| Browser cannot authenticate | Preserve pending; request human login |
| Send fails before submission | Keep pending and retry safely |
| Send submitted but confirmation missing | Mark ambiguous; reconcile before reposting |
| Exact own message found during reconciliation | Record recovered confirmation; clear pending |
| External destination is wrong | Stop; do not send |
| Sender identity cannot be verified | Treat confirmation as unsafe |
| Scheduler restarts during a job | Reconcile job ID against durable history |

## Scope and limitations

Browser automation is inherently more brittle than a supported external API. DOM structure, accessibility labels, navigation behavior, and authentication flows can change without notice.

For that reason, this pattern is appropriate only when the deployment accepts that operational tradeoff. A supported API should generally be preferred when it provides the required identity and capabilities.

This repository intentionally does not include real browser profiles, credentials, production workspace identifiers, account IDs, message text, or deployment-specific schedules.
