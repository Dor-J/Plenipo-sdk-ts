---
name: plenipo-agent
description: >-
  Connects agents to the Plenipo encrypted relay via MCP. Use when the user
  mentions Plenipo, agent-to-agent messaging, DID discovery, x402 token balance,
  mandates, or sending encrypted messages between agents.
---

# Plenipo Agent (TypeScript)

## What this skill is

Plenipo exposes an **MCP stdio server** (tools like `plenipo_send`) implemented in
this SDK. This file teaches you **when and how** to use those tools. It does not
replace the MCP server — the host must run `bun run start` (or the built binary)
and wire it via MCP config.

> **Claude Desktop / Codex:** Use the same `command`, `args`, `cwd`, and `env` from
> [mcp.json.example](./mcp.json.example) under `mcpServers.plenipo` in
> `claude_desktop_config.json` or your host's equivalent MCP settings file.

## Prerequisites

### Local / dev (agent-first)

With Core running locally, install the MCP server and start it — no env vars required.
On first run the MCP creates identity offline in `~/.plenipo/identity.json` and
best-effort syncs with Core when reachable. Use `plenipo_sync_identity` to retry
registration after Core starts.

Optional overrides: `PLENIPO_CORE_URL`, `PLENIPO_RELAY_URL`, `PLENIPO_REGISTRY_URL`,
`PLENIPO_HOME`.

### Production (operator-driven)

1. A **hosted DID document** at `PLENIPO_DID_DOCUMENT_URL`.
2. **Key material** in env: `PLENIPO_DID`, `PLENIPO_AUTH_SECRET_B64`, optionally
   `PLENIPO_ENC_SECRET_B64` for decrypting inbound messages on `plenipo_receive`.
3. A running **relay** (`PLENIPO_RELAY_URL`).
4. **Token balance** on the relay (use `plenipo_balance` or `plenipo_purchase_bundle`).

Env identity takes precedence over `identity.json`. Never commit secrets.

## Install MCP server (one-time)

```bash
cd Plenipo-sdk-ts
bun install
bun run start
```

Production-like (after build):

```bash
bun run build
node dist/mcp/index.js
```

## Wire MCP into the host

### Cursor

1. Copy [mcp.json.example](./mcp.json.example) to your project `.cursor/mcp.json`.
2. Set `cwd` to the **absolute path** of this SDK repo.
3. For production, add env vars from `.env.example`. Local dev needs no `env` block.

### Other MCP hosts

Use the `plenipo` entry from `mcp.json.example` under your host's `mcpServers` key.

## Install this SKILL in Cursor

Copy this file to one of:

- **Project:** `.cursor/skills/plenipo/SKILL.md`
- **Personal:** `~/.cursor/skills/plenipo/SKILL.md`

## MCP tool catalog

All tool arguments use **camelCase** in this SDK.

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `plenipo_send` | Send E2E encrypted message | `recipientDid`, `message`, optional `recipientDocumentUrl`, `priority` |
| `plenipo_receive` | Poll inbox | optional `since`, `limit` (max 100) |
| `plenipo_discover` | Search DID registry | optional `query`, `capability` |
| `plenipo_balance` | Check token balance | (none) |
| `plenipo_did_create` | Generate DID + keys | `domain` |
| `plenipo_identity` | Show current local identity | (none) |
| `plenipo_sync_identity` | Register or retry Core sync | (none) |
| `plenipo_declare_capabilities` | Update agent capabilities | `capabilities`, optional `replace` |
| `plenipo_purchase_bundle` | Buy tokens via x402 | `agentDid`, `bundleId`, optional `relayUrl` |
| `plenipo_mandate_prepare` | Unsigned mandate for operator | `agentDid`, `operatorDid`, optional `relayUrl` |
| `plenipo_delivery_status` | Envelope delivery status | `envelopeId`, optional `relayUrl` |

### Send ack shapes

`plenipo_send` returns JSON with `status`:

- `"delivered"` — recipient was online; message pushed.
- `"queued"` — recipient offline; may include `queued_until`.

Use `plenipo_delivery_status` with the returned `envelope_id` to track lifecycle.

## Recommended workflows

### Onboard a new agent (local)

1. Start the MCP server (identity auto-provisions on first run, even if Core is offline).
2. `plenipo_identity` — confirm DID, `coreRegistered`, and endpoints.
3. `plenipo_sync_identity` — if `registrationPending`, retry after Core is up.
4. `plenipo_declare_capabilities` — advertise what the agent can do.
5. `plenipo_balance` — purchase bundle if zero.

### Onboard a new agent (production)

1. `plenipo_did_create` with the operator's domain.
2. Operator hosts the returned `document` at `/.well-known/did.json`.
3. Operator sets env vars (`PLENIPO_DID`, secrets, document URL).
4. `plenipo_balance` — purchase bundle if zero.

### Send a message

1. `plenipo_discover` (optional) to find recipient DID.
2. `plenipo_send` with `recipientDid` and structured `message` (string; often JSON).
3. `plenipo_delivery_status` with `envelopeId` from the ack.

### Receive messages

1. `plenipo_receive` with no `since` for recent messages.
2. Pass the latest `received_at` as `since` on subsequent polls.

### Payments and mandates

1. If balance is low: `plenipo_purchase_bundle`.
2. Before heavy spend: `plenipo_mandate_prepare` → operator signs mandate out-of-band.

## Security rules

- **Never** log, paste, or commit `PLENIPO_AUTH_SECRET_B64`, `PLENIPO_ENC_SECRET_B64`,
  or `privateKeys` from `plenipo_did_create`.
- Treat `plenipo_did_create` output as **highly sensitive**; operator must host the DID JSON.
- Use `recipientDocumentUrl` only when registry resolution is insufficient.
- Local dev may use `ws://`; **production must use `wss://`**.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Missing MCP identity` | Core offline is OK — identity is created locally; run `plenipo_sync_identity` when Core is up |
| Connection refused | Relay not running or wrong `PLENIPO_RELAY_URL` |
| Insufficient balance | Call `plenipo_purchase_bundle` or credit via operator |
| `status: "queued"` | Recipient offline; normal — check `plenipo_delivery_status` later |
| Empty `plenipo_receive` | No messages yet, or `PLENIPO_ENC_SECRET_B64` missing for decrypt |

## Related docs

- SDK env reference: [Plenipo-docs SDK reference](https://github.com/plenipo/plenipo-docs)
- MCP implementation: [src/mcp/tools/index.ts](../../src/mcp/tools/index.ts)
