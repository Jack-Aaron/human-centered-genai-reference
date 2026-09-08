# Deployment

## Recommended topology

```text
HTTPS reverse proxy / outbound tunnel
              |
              v
       127.0.0.1:3000
              |
              v
      Node.js application
              |
       +------+------+
       |             |
     SQLite     corpus snapshot
```

Do not expose the Node listener directly to the internet when a reverse proxy or tunnel is available.

## Dedicated service account

Create a Unix account whose only writable application path is the data directory. The example systemd unit assumes:

```text
user/group: genai-reference
application: /opt/genai-reference
data:        /opt/genai-reference/data
```

## Configuration

Copy `.env.example` to a root/service-owned `.env` and set permissions appropriately. Secrets should not be present in the Git repository.

Important production choices:

- `HOST=127.0.0.1`
- a non-public application port;
- a persistent absolute database path;
- a production external corpus URL;
- a deliberate corpus maximum age;
- deliberate global and per-client quotas;
- Slack signing secret only when the standalone Slack route is used.

## systemd hardening

`deploy/genai-reference.service` demonstrates:

- a dedicated unprivileged user;
- `NoNewPrivileges=true`;
- empty Linux capability bounding set;
- strict filesystem protection;
- an explicit writable data directory;
- private `/tmp`;
- restricted devices, namespaces, kernel controls, and address families.

Security directives should be validated on the target distribution and systemd version. Do not chase a numerical sandbox score at the expense of required application behavior.

## Corpus refresh timer

`deploy/corpus-refresh.timer` periodically executes the one-shot refresh service. Serving reads only the validated local snapshot.

A manual forced refresh is available through:

```bash
node dist/cli.js corpus-refresh --force
```

## Optional delivery agent

When a deployment uses browser automation or another stateful external-session mechanism, run it under a **different Unix account** from the serving application.

The delivery account should have only:

- its own narrowly scoped API client private key;
- its own pending/history state directory;
- the external browser/session profile when required;
- the executable and configuration needed for delivery.

It should not be able to read the serving SQLite database, backups, administrative environment file, or server-side secrets.

`deploy/delivery-agent.service` is a generic systemd pattern for a persistent low-memory scheduler that launches an external delivery worker only when needed. It intentionally omits `RestrictNamespaces=` because browser sandboxes may require user namespaces; validate the browser and service sandbox together before adding namespace restrictions.

A persistent browser does not need to remain running between deliveries. Keeping the scheduler resident while launching the browser only for reconciliation/send/verification substantially reduces idle memory use.

See [AUTOMATED_DELIVERY.md](AUTOMATED_DELIVERY.md).

## Backups

Use SQLite-aware backup APIs rather than copying a live WAL-mode database with plain `cp`.

The CLI provides:

```bash
node dist/cli.js backup
```

Before risky production changes:

1. verify the active database path;
2. create a SQLite-aware backup;
3. verify the backup exists;
4. perform the change;
5. run application stats and integrity checks afterward.

## Reverse proxy considerations

At the edge, add conservative limits for obviously abusive HTTP traffic. Application-level authentication and quotas remain authoritative; edge limits are cheap garbage filtering rather than a trust mechanism.

Terminate TLS before traffic reaches the localhost-bound service.
