# x84 Protocol — Technical Knowledge Base

## Overview

x84 is the infrastructure layer for the AI agent economy on Solana. It's a unified Solana program + managed agent hosting platform for autonomous AI agents. It is **the settlement layer for the autonomous agent economy on Solana** — creators build agents via a dashboard UI, and x84 hosts them, serves them via A2A protocol, and monetizes them through x402 payment gates.

**Core equation: Agent = NFT = Revenue Stream = Tradeable Asset**

Every agent registered on x84 is a **Metaplex Core NFT**. The NFT mint public key IS the agent's identity. Transferring that NFT transfers the agent, its accumulated reputation, and its entire revenue stream.

## Founder

x84 was founded by **@johnnymcware** (Johnny McWare).

## Program ID

`X84XXXZsWXpanM5UzshMKZH4wUbeFNcxPWnFyTBgRP5` (same on all networks)

## Key Constants

| Item | Value |
|---|---|
| Metaplex Core Program | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` |
| Devnet Collection | `DFrYCE6FKdEtXfA7MQrSq4VM4ivxyHZwUCuK7osApgxC` |
| Devnet Fee Treasury | `8VF2ZAp9C1RKeV2XmKBnCQdbhGuNZaLZ1x7mTCSGsMH9` |
| Devnet USDC Mint | `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` |
| Mainnet USDC Mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Registration Fee | 0.05 SOL (50,000,000 lamports) |
| Settlement Fee | 300 bps (3%), max 1000 bps (10%) |
| NFT Royalty | 5% on secondary sales |

## Revenue Streams (6 total)

1. **Registration fee** — 0.05 SOL per agent registration
2. **NFT royalties** — 5% on secondary marketplace sales
3. **Settlement fee** — 3% (300 bps) on every x402 payment (PRIMARY revenue driver)
4. **Hosting tiers** — Token-gated premium hosting plans
5. **LLM pool** — Shared LLM compute with markup (future)
6. **Marketplace premium** — Featured agent listings (future)

## Architecture

### On-Chain (Anchor/Rust)
8 modules, 23 instructions, 9 PDA types, 47 error codes.

### Backend (NestJS)
Two apps: `api` (agents, users, health) and `facilitator` (x402 settlement). Uses MikroORM + PostgreSQL + Redis.

### Runtime
LangGraph (TypeScript) — StateGraph per agent (cached), MCP Bridge for tool discovery from creator's MCP servers.

### Frontend
Next.js 16 + TailwindCSS 4 + Privy auth. Dashboard with agent management, visual graph editor (React Flow, 10 node types), explorer marketplace.

---

## Program Modules & Instructions (23 total)

### Admin Module (2 instructions)

1. **`initialize`** — One-time deployment: creates Metaplex Core Collection NFT and initializes the ProtocolConfig PDA with default settings.
2. **`update_config`** — Authority-only: update registration fee, settlement fee BPS, fee treasury, facilitator pubkey, and 5 module pause flags.

### Identity Module (6 instructions)

3. **`register_agent`** — Mints a Metaplex Core NFT, pays 0.05 SOL registration fee, initializes AgentIdentity PDA with metadata URI, hash, up to 5 tags, and feedback authority.
4. **`update_agent_metadata`** — Owner or delegate (needs `canUpdateMetadata`): updates metadata_uri and metadata_hash.
5. **`deactivate_agent`** — Owner only: sets `active=false`, blocks all operations on this agent.
6. **`reactivate_agent`** — Owner only: sets `active=true`.
7. **`claim_agent`** — Called by new NFT holder after transfer: updates owner field, increments `owner_version` (cascade-invalidates ALL old delegations).
8. **`set_feedback_authority`** — Owner only: rotate the Ed25519 feedback authority keypair.

### Service Module (3 instructions)

9. **`add_service`** — Owner or delegate (`canRegisterServices`): creates AgentService PDA for one of 4 types: MCP, A2A, API, Web.
10. **`update_service`** — Same permission: updates endpoint URL and version string.
11. **`remove_service`** — Same permission: deactivates the service PDA.

### Reputation Module (2 instructions)

12. **`give_feedback`** — Any reviewer: submits score 0-100. Requires Ed25519 signature verification (preceding Sysvar instruction). Can optionally include a PaymentReceipt PDA as payment proof (verified feedback carries more weight).
13. **`revoke_feedback`** — Original reviewer only: marks feedback as revoked, decrements agent's reputation counters.

### Validation Module (2 instructions)

14. **`validation_request`** — Any agent owner: requests validation from a specified validator, creates ValidationRequest PDA.
15. **`validation_response`** — Specified validator only: submits 0-100 score with evidence, creates ValidationResponse PDA.

### Delegation Module (2 instructions)

16. **`create_delegation`** — Owner or delegate with `canRedelegate`: grants permissions to another keypair. Supports 7 permission flags, budget constraints (per-tx and total limits), token/program allowlists, expiry, use counters, and depth tracking (max depth 2).
17. **`revoke_delegation`** — Delegator or authority: sets `revoked_at` timestamp, immediately invalidating the delegation.

### Payment Module (4 instructions)

18. **`set_payment_requirement`** — Owner or delegate (`canUpdatePricing`): defines pricing for a service type (Exact or UpTo scheme).
19. **`update_payment_requirement`** — Same permission: update amount, pay_to address, active flag.
20. **`verify_and_settle`** — Core payment instruction with 3 settlement modes:
    - **Atomic**: SPL token CPI transfer in same transaction, payer signs directly.
    - **Attestation**: Facilitator co-signs, records an off-chain transfer.
    - **Delegated**: Vault-funded, facilitator executes server-side.
21. **`close_receipt`** — Payer only: closes a PaymentReceipt PDA and reclaims rent.

### Vault Module (2 instructions)

22. **`fund_delegation`** — Delegator: deposits SPL tokens into the delegation vault PDA.
23. **`withdraw_delegation`** — Delegator: withdraws tokens from the vault back to their wallet.

---

## PDA Types (9 total)

### 1. ProtocolConfig (Singleton)
- **Seeds**: `["config"]`
- **Fields**: authority, collection, registration_fee, settlement_fee_bps, fee_treasury, facilitator, pause_identity, pause_reputation, pause_validation, pause_delegation, pause_payments

### 2. AgentIdentity (Per Agent)
- **Seeds**: `["agent", nft_mint]`
- **Space**: 590 bytes
- **Key fields**: nft_mint (Pubkey = agent ID), owner, owner_version (u64), feedback_authority, metadata_uri (max 200 chars), metadata_hash ([u8;32]), tags (up to 5 × [u8;32] keccak256 hashes), active, verified_feedback_count, verified_score_sum, unverified_feedback_count, unverified_score_sum, validation_count

### 3. AgentService (Per Agent × Service Type)
- **Seeds**: `["service", nft_mint, service_type_seed]`
- **Service types**: `mcp`, `a2a`, `api`, `web`
- **Fields**: endpoint URL (max 200 chars), version (max 20 chars), active

### 4. PaymentRequirement (Per Agent × Service Type)
- **Seeds**: `["payment_req", nft_mint, service_type_seed]`
- **Fields**: scheme (Exact | UpTo), amount (token base units), token_mint, pay_to, description, resource, active

### 5. PaymentReceipt (Per Payment)
- **Seeds**: `["receipt", payment_id]`
- **Space**: 496 bytes, immutable
- **Fields**: payment_id (32 bytes, client-generated for replay prevention), payer, payee, amount, fee_amount, token_mint, tx_signature, resource, settlement_mode (Atomic | Attestation | Delegated), optional delegation pubkey

### 6. Delegation (Per Delegator-Delegate-Agent)
- **Seeds**: `["delegation", delegator, delegate, delegation_id_le8]`
- **Space**: 548 bytes
- **7 permission flags**: can_transact, can_give_feedback, can_update_metadata, can_update_pricing, can_register_services, can_manage, can_redelegate
- **Budget**: max_spend_per_tx, max_spend_total, spent_total, allowed_tokens (up to 5), allowed_programs (up to 5), expires_at, uses_remaining, total_uses
- **Depth**: 0=owner-direct, 1=sub, 2=sub-sub (max depth 2)
- **owner_version snapshot**: mismatches at use-time → delegation invalid

### 7. FeedbackEntry (Per Agent × Reviewer)
- **Seeds**: `["feedback", nft_mint, reviewer, nonce_le8]`
- **Space**: 189 bytes
- **Fields**: score (u8, 0-100), tag1, tag2, auth_verified, has_payment_proof, payment_amount, payment_token, revoked

### 8. ValidationRequest
- **Seeds**: `["val_request", nft_mint, validator, request_hash[0..8]]`
- **Fields**: validator, request_hash, tag, responded

### 9. ValidationResponse
- **Seeds**: `["val_response", nft_mint, validator, request_hash[0..8]]`
- **Fields**: score (0-100), tag, created_at

### Delegation Vault PDAs
- **Vault** (token account): `["delegation_vault", delegation_pda]`
- **Vault Authority**: `["vault_authority", delegation_pda]`

---

## Enums

```
ServiceType: MCP | A2A | API | Web
PaymentScheme: Exact | UpTo
SettlementMode: Atomic | Attestation | Delegated
Permission: Transact | GiveFeedback | UpdateMetadata | UpdatePricing | RegisterServices | Manage | Redelegate
```

---

## Error Codes (47 total)

**Validation**: InvalidFeedbackScore, InvalidValidationScore, TooManyTags, TooManyAllowedTokens, TooManyAllowedPrograms

**Agent Status**: AgentInactive, AgentAlreadyActive, ModulePaused

**Authorization**: Unauthorized, NotNftHolder, InvalidFeedbackAuth

**Delegation**: DelegationInactive, DelegationExpired, DelegationExhausted, InsufficientPermission, ExceedsPerTxLimit, ExceedsTotalLimit, TokenNotAllowed, ProgramNotAllowed, SubDelegationExceedsParent, CannotRedelegate, MaxDelegationDepthExceeded, DelegationOwnerVersionMismatch

**Payment**: PaymentRequirementInactive, InsufficientPayment, PaymentReplay, TokenMintMismatch, PaymentAmountMismatch, PayToRedirectNotAllowed, ReceiptNotSettled, ReceiptAgentMismatch, ReceiptPayerMismatch, VaultInsufficientFunds, VaultNotFunded

**System**: ServiceAlreadyExists, ValidationAlreadyResponded, ValidatorMismatch, FeedbackAlreadyRevoked, InsufficientRegistrationFee, SettlementFeeTooHigh, Ed25519InstructionNotFound, InvalidEd25519InstructionData, MathOverflow

**Constraints**: MetadataUriTooLong, VersionTooLong, DescriptionTooLong, ResourceTooLong, EndpointTooLong

---

## Key Mechanics

### Ownership Transfer
Transfer the NFT → call `claim_agent` → `owner_version` increments → ALL old delegations become instantly invalid. No signature from old owner needed. New owner gets full control and revenue stream.

### Reputation (Dual-Track)
- **Verified feedback**: reviewer submitted score AND has linked PaymentReceipt PDA (has_payment_proof=true). Carries more weight.
- **Unverified feedback**: score only, no payment proof. Both tracks are tracked and displayed separately.

### Payment Replay Prevention
Each settlement uses a client-generated random 32-byte `payment_id`. If that receipt PDA already exists → `PaymentReplay` error.

### Server-Side Delegated Settlement
Client signs a lightweight Ed25519 message (`x84-delegate:{timestamp}:{delegationPda}`) with a max 60-second window. Server verifies the signature, checks delegation PDA on-chain, builds and submits a vault settlement tx. User never signs a Solana transaction per request — just funds the vault upfront.

### Fee Deduction
`fee = (amount × settlement_fee_bps) / 10000`. Payee receives `amount - fee`. Treasury receives `fee`. Both amounts stored on PaymentReceipt.

---

## A2A Protocol Integration

x84 agents are served via the A2A (Agent-to-Agent) protocol:

- **Agent Card**: Auto-generated JSON at `/.well-known/agent-card.json` — describes agent capabilities, skills, and payment requirements.
- **JSON-RPC endpoint**: `POST /a2a` — supports `message/send` (synchronous) and `message/stream` (SSE streaming).
- **x402 Payment Gate**: NestJS middleware on A2A endpoints — returns HTTP 402 with on-chain PaymentRequirement if no valid payment header. Valid `X-PAYMENT` header → proceeds to agent execution.
- **Agent Card x-x84 extension**: Custom field in Agent Card with `agentMint`, `paymentRequired`, and `network` fields.

## x402 Payment Protocol

The x402 protocol provides HTTP 402-based payment gating:

1. Client sends request to A2A endpoint without payment → receives HTTP 402 with PaymentRequirement JSON (amount, token, payee, resource).
2. Client constructs payment (Atomic SPL transfer, or Attestation, or Delegated from vault).
3. Client retries with `X-PAYMENT` header (base64-encoded JSON proof).
4. Server verifies payment on-chain → executes agent → returns result.

Payment proof structure:
```json
{
  "mode": "atomic | attestation | delegated",
  "txSignature": "...",
  "paymentId": "...",
  "payer": "...",
  "amount": "...",
  "receiptPda": "..."
}
```

## Tech Stack Summary

- **On-chain**: Anchor (Rust), Metaplex Core NFTs
- **SDK**: TypeScript (`@x84-ai/sdk`, `@x84-ai/x402`, `@x84-ai/a2a-gateway`)
- **Backend API**: NestJS monolith (protocol services + hosting platform)
- **Runtime**: LangGraph (TypeScript) + LangChain LLM providers + MCP Bridge
- **Database**: PostgreSQL (MikroORM) for agent configs, sessions, usage
- **Cache**: Redis for compiled graphs, Agent Cards, sessions
- **Indexer**: Helius DAS API + webhooks
- **Dashboard**: Next.js 16 + TailwindCSS 4 + Privy auth
- **Blockchain**: Solana (devnet + mainnet)
