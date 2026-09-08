# Threat Model

## Assumptions

Public clients may be curious, buggy, or actively hostile. After authentication, a client may still attempt to:

- call the endpoint as often as possible;
- exhaust shared inventory;
- submit concurrent requests;
- replay captured requests;
- probe alternate methods, paths, query strings, or body shapes;
- claim another client ID;
- learn internal queue state;
- bypass quotas;
- register malformed or private key material.

The design therefore follows this rule:

> Authenticate the client, then trust it with nothing beyond the narrowly authorized capability and limits assigned to that identity.

## Exposed capability

An approved API client can request one available candidate subject to limits.

It cannot:

- inspect queue contents;
- select a particular candidate;
- insert candidates;
- reset counters;
- change its quota;
- approve registrations;
- retrieve other client metadata;
- invoke arbitrary model prompts;
- administer the service.

## Inventory exhaustion

A global cap alone is insufficient when clients compete for finite inventory. A single authenticated client could consume the global allowance before others.

The service therefore combines global limits with per-client successful-request limits.

## Replay

A timestamp alone is not enough: a valid request can be replayed repeatedly during the timestamp window. A unique nonce is signed into every request and persisted after successful authentication.

## Concurrent pulls

A cheap preflight gate improves efficiency but does not provide correctness. Candidate selection, gate re-checking, status mutation, and quota increments occur in one SQLite transaction.

## External source failure

Novelty verification depends on an external source of truth. Returning an unchecked candidate during an outage would violate the data-integrity guarantee, so serving fails closed when no sufficiently fresh validated snapshot exists.

## Scope

This reference architecture targets ordinary internet abuse and integration mistakes. It is not presented as protection against large volumetric denial-of-service attacks or compromise of the host operating system.
