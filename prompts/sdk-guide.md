# @x84-ai/sdk — Developer Reference

The x84 SDK is a single TypeScript package (`@x84-ai/sdk`) for building on the x84 Solana protocol. It provides instruction builders, PDA derivation, account fetchers, event parsing, error handling, and a zero-dependency REST API client.

**Version**: 0.1.3
**Peer Dependencies**: `@coral-xyz/anchor` >=0.31, `@solana/web3.js` ^1.98, `@solana/spl-token` >=0.4.9

## Installation

```bash
pnpm add @x84-ai/sdk @coral-xyz/anchor @solana/web3.js @solana/spl-token
```

## Sub-path Exports

```typescript
// Core — instructions, PDAs, accounts, events, errors, types, constants, utils
import { registerAgent, fetchAgentIdentity, findAgentPda } from "@x84-ai/sdk";

// Settlement — verify_and_settle + close_receipt instruction builders
import { buildVerifyAndSettleIx, buildCloseReceiptIx } from "@x84-ai/sdk/settlement";

// API Client — zero-dependency REST client (uses native fetch)
import { X84ApiClient } from "@x84-ai/sdk/api";

// IDL — Anchor IDL types and JSON
import { IDL } from "@x84-ai/sdk/idl";
```

## Program Setup

```typescript
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Connection, clusterApiUrl, PublicKey } from "@solana/web3.js";
import { IDL, type X84 } from "@x84-ai/sdk/idl";
import { NETWORKS } from "@x84-ai/sdk";

const connection = new Connection(clusterApiUrl("devnet"));
const provider = new AnchorProvider(connection, wallet, {});
const net = NETWORKS.devnet;
const program = new Program<X84>(IDL, net.programId, provider);
```

---

## Constants & Network Config

```typescript
import { X84_PROGRAM_ID, NETWORKS, DEFAULT_REGISTRATION_FEE, DEFAULT_SETTLEMENT_FEE_BPS } from "@x84-ai/sdk";

X84_PROGRAM_ID  // "X84XXXZsWXpanM5UzshMKZH4wUbeFNcxPWnFyTBgRP5"

// Default protocol fees
DEFAULT_REGISTRATION_FEE     // 50_000_000 lamports (0.05 SOL)
DEFAULT_SETTLEMENT_FEE_BPS   // 300 (3%)

// Network configs include deployed addresses
NETWORKS.devnet.programId       // PublicKey
NETWORKS.devnet.collection      // Collection NFT mint
NETWORKS.devnet.feeTreasury     // Treasury wallet
NETWORKS.devnet.tokenMint       // USDC mint
NETWORKS.devnet.treasuryTokenAccount
NETWORKS.devnet.facilitator
```

---

## Enums & Types

```typescript
import { ServiceType, PaymentScheme, SettlementMode } from "@x84-ai/sdk";

// Service types (used as PDA seeds: "mcp", "a2a", "api", "web")
ServiceType.MCP | ServiceType.A2A | ServiceType.API | ServiceType.Web

// Payment schemes
PaymentScheme.Exact   // payer must send exact amount
PaymentScheme.UpTo    // payer can send up to amount

// Settlement modes
SettlementMode.Atomic        // Real SPL transfer, payer signs
SettlementMode.Attestation   // Off-chain payment, facilitator co-signs
SettlementMode.Delegated     // Vault-based, delegation required

// Delegation permissions interface
interface DelegationPermissions {
  canTransact: boolean;
  canGiveFeedback: boolean;
  canUpdateMetadata: boolean;
  canUpdatePricing: boolean;
  canRegisterServices: boolean;
  canManage: boolean;
  canRedelegate: boolean;
}

// Delegation constraints interface
interface DelegationConstraints {
  maxSpendPerTx: BN;
  maxSpendTotal: BN;
  allowedTokens: PublicKey[];   // max 5
  allowedPrograms: PublicKey[]; // max 5
  expiresAt: BN;               // unix timestamp, 0 = no expiry
  usesRemaining: BN;           // 0 = unlimited
}
```

---

## Identity Instructions

```typescript
import {
  registerAgent,
  updateAgentMetadata,
  deactivateAgent,
  reactivateAgent,
  claimAgent,
  setFeedbackAuthority,
} from "@x84-ai/sdk";
```

### Register Agent

Mints a Metaplex Core NFT and creates an AgentIdentity PDA. The NFT mint pubkey becomes the `agent_id`.

```typescript
const { instruction, asset, agentPda } = await registerAgent(program, {
  name: "My Oracle Agent",
  owner: wallet.publicKey,
  configAuthority: net.programId,
  metadataUri: "https://example.com/metadata.json",
  metadataHash: hashBytes(Buffer.from(metadataJson)),
  feedbackAuthority: feedbackKeypair.publicKey,
  tags: ["oracle", "defi"],       // up to 5 strings (auto-hashed via SHA-256)
  collection: net.collection!,
  feeTreasury: net.feeTreasury!,
});

// `asset` is a Keypair — its publicKey is the NFT mint (= agent_id)
// `agentPda` is the AgentIdentity PDA
// Signers needed: owner, asset keypair, configAuthority
```

### Update Agent Metadata

```typescript
const { instruction, agentPda } = await updateAgentMetadata(program, {
  caller: wallet.publicKey,       // owner or delegate
  nftMint: agentMint,
  newUri: "https://updated.com/metadata.json",
  newHash: newMetadataHash,
  delegation: delegationPda,      // optional — pass if caller is a delegate
});
```

### Deactivate / Reactivate Agent

```typescript
const { instruction } = await deactivateAgent(program, wallet.publicKey, agentMint);
const { instruction } = await reactivateAgent(program, wallet.publicKey, agentMint);
```

### Claim Agent (After NFT Transfer)

Must be called by the new owner after receiving the NFT. Increments `owner_version`, which invalidates all existing delegations.

```typescript
const { instruction, agentPda } = await claimAgent(program, newOwner, agentMint);
// Signer: newOwner (must currently hold the NFT)
```

### Set Feedback Authority

```typescript
const { instruction } = await setFeedbackAuthority(program, owner, agentMint, newAuthorityPubkey);
```

---

## Service Instructions

Register and manage service endpoints (MCP, A2A, API, Web).

```typescript
import { addService, updateService, removeService, ServiceType } from "@x84-ai/sdk";

// Register an A2A endpoint
const { instruction, servicePda } = await addService(program, {
  caller: wallet.publicKey,
  nftMint: agentMint,
  serviceType: ServiceType.A2A,
  endpoint: "https://myagent.com/.well-known/agent-card.json",
  version: "1.0.0",
  delegation: undefined,        // optional — pass if caller is a delegate
});

// Update service
const { instruction } = await updateService(program, {
  caller: wallet.publicKey,
  nftMint: agentMint,
  serviceType: ServiceType.A2A,
  newEndpoint: "https://v2.myagent.com/agent-card.json",
  newVersion: "2.0.0",
});

// Remove service (closes PDA, refunds rent)
const { instruction } = await removeService(program, {
  caller: wallet.publicKey,
  nftMint: agentMint,
  serviceType: ServiceType.A2A,
});
```

---

## Reputation Instructions

Feedback scoring: 0–100 scale. Requires Ed25519 signature verification on-chain.

```typescript
import { giveFeedback, revokeFeedback } from "@x84-ai/sdk";

// Give feedback — auto-builds Ed25519 verify instruction if secret provided
const { ed25519Instruction, instruction, feedbackPda } = await giveFeedback(
  program,
  {
    reviewer: wallet.publicKey,
    nftMint: agentMint,
    score: 85,                            // 0-100
    tag1: "quality",                      // descriptive tag (hashed on-chain)
    tag2: "speed",
    detailUri: "https://example.com/review.json",
    detailHash: reviewHash,
    feedbackAuth: feedbackAuthorityPubkey,
    feedbackNonce: 0,                     // unique per reviewer-agent pair
    paymentReceipt: receiptPda,           // optional — links to payment for "verified" status
  },
  feedbackAuthoritySecretKey,             // optional Uint8Array — auto-generates Ed25519 ix
);

// Transaction needs BOTH instructions in order:
// [ed25519Instruction, instruction]
// The Ed25519 ix must come immediately before the feedback ix.

// Revoke your own feedback
const { instruction } = await revokeFeedback(program, {
  reviewer: wallet.publicKey,
  nftMint: agentMint,
  feedbackNonce: 0,
});
```

Ed25519 message format: `reviewer_pubkey_bytes || nft_mint_bytes` (64 bytes total).

---

## Validation Instructions

Two-step quality assurance: request → response with score + evidence.

```typescript
import { validationRequest, validationResponse } from "@x84-ai/sdk";

// Step 1: Agent owner requests validation
const { instruction, validationRequestPda } = await validationRequest(program, {
  caller: wallet.publicKey,
  nftMint: agentMint,
  validator: validatorPubkey,
  requestHash: hashBytes(Buffer.from("audit-request-v1")),  // 32-byte hash
  tag: hashTag("security"),                                  // 32-byte hash
  requestUri: "https://example.com/audit-request.json",
  delegation: undefined,
});

// Step 2: Validator responds with score
const { instruction, validationResponsePda } = await validationResponse(program, {
  validator: validatorPubkey,
  nftMint: agentMint,
  requestHash: requestHash,   // must match the request
  score: 92,                  // 0-100
  tag: hashTag("security"),
  evidenceUri: "https://example.com/audit-report.json",
  evidenceHash: reportHash,
});
```

---

## Delegation Instructions

Granular permission grants with constraints. Supports up to 3 levels of sub-delegation.

### DelegationBuilder (Fluent API)

```typescript
import { DelegationBuilder, revokeDelegation } from "@x84-ai/sdk";

const { instruction, delegationPda, delegationId } = await new DelegationBuilder()
  .transact()                                        // canTransact = true
  .feedback()                                        // canGiveFeedback = true
  .metadata()                                        // canUpdateMetadata = true
  .pricing()                                         // canUpdatePricing = true
  .services()                                        // canRegisterServices = true
  .manage()                                          // canManage = true
  .redelegate()                                      // canRedelegate = true
  // or use .allPermissions() for all 7
  .spendLimit(new BN(1_000_000), new BN(100_000_000))  // per-tx, total (lamports/tokens)
  .tokens([usdcMint])                                   // restrict to specific token mints (max 5)
  .programs([someProgram])                               // restrict to specific programs (max 5)
  .expiry(Math.floor(Date.now() / 1000) + 86400)       // expires in 24h (unix timestamp)
  .uses(100)                                             // max 100 uses
  .build(program, delegator, delegate, agentMint);

// Signer: delegator (must be agent owner or parent delegate)
```

### Sub-delegation

```typescript
const { instruction, delegationPda: subPda } = await new DelegationBuilder()
  .transact()
  .parent(parentDelegationPda)    // links to parent delegation
  .build(program, delegate, subDelegate, agentMint);

// Sub-delegation permissions cannot exceed parent's permissions.
// Max 3 levels of delegation depth.
```

### Revoke Delegation

```typescript
const { instruction } = await revokeDelegation(program, {
  caller: wallet.publicKey,      // delegator or agent owner
  nftMint: agentMint,
  delegationPda: delegationPda,
});
```

### Direct createDelegation (Without Builder)

```typescript
import { createDelegation } from "@x84-ai/sdk";

const { instruction, delegationPda, delegationId } = await createDelegation(program, {
  delegator: wallet.publicKey,
  delegate: delegatePubkey,
  nftMint: agentMint,
  permissions: {
    canTransact: true,
    canGiveFeedback: true,
    canUpdateMetadata: false,
    canUpdatePricing: false,
    canRegisterServices: false,
    canManage: false,
    canRedelegate: false,
  },
  constraints: {
    maxSpendPerTx: new BN(0),      // 0 = unlimited
    maxSpendTotal: new BN(0),
    allowedTokens: [],
    allowedPrograms: [],
    expiresAt: new BN(0),          // 0 = no expiry
    usesRemaining: new BN(0),      // 0 = unlimited
  },
});
```

---

## Payment Instructions

Set pricing for agent services. Payment requirements define what users must pay.

```typescript
import {
  setPaymentRequirement,
  updatePaymentRequirement,
  PaymentScheme,
  ServiceType,
} from "@x84-ai/sdk";

// Set pricing for A2A service
const { instruction, paymentReqPda } = await setPaymentRequirement(program, {
  caller: wallet.publicKey,
  nftMint: agentMint,
  serviceType: ServiceType.A2A,
  scheme: PaymentScheme.Exact,              // Exact or UpTo
  amount: new BN(100_000),                  // 0.1 USDC (6 decimals)
  tokenMint: usdcMint,
  payTo: wallet.publicKey,                  // where payments go
  description: "Per-query fee",
  resource: "/a2a",
  delegation: undefined,                    // optional
});

// Update pricing
const { instruction } = await updatePaymentRequirement(program, {
  caller: wallet.publicKey,
  nftMint: agentMint,
  serviceType: ServiceType.A2A,
  newAmount: new BN(200_000),               // optional
  newPayTo: newPayToWallet,                 // optional
  newDescription: "Updated pricing",        // optional
  newActive: true,                          // optional — disable/enable
  delegation: undefined,
});
```

---

## Settlement Instructions

Build verify_and_settle transactions. The protocol automatically splits the 3% fee to the treasury.

```typescript
import { buildVerifyAndSettleIx, buildCloseReceiptIx } from "@x84-ai/sdk/settlement";
import { SettlementMode, randomPaymentId, findAgentPda, findPaymentReqPda } from "@x84-ai/sdk";

// Build settlement instruction
const { instruction, receiptPda } = await buildVerifyAndSettleIx({
  program,
  paymentId: randomPaymentId(),             // 32 random bytes
  txSignature: txSigBytes,                  // 64-byte tx signature
  amount: new BN(100_000),
  resource: "/a2a",
  settlementMode: SettlementMode.Atomic,    // Atomic | Attestation | Delegated
  accounts: {
    payer: payerWallet,
    nftMint: agentMint,
    agentIdentity: agentPda,
    paymentRequirement: paymentReqPda,
    payerTokenAccount: payerAta,
    payeeTokenAccount: payeeAta,
    treasuryTokenAccount: net.treasuryTokenAccount!,
    tokenMint: net.tokenMint!,
    tokenProgram: TOKEN_PROGRAM_ID,
    config: configPda,
    facilitator: net.facilitator,           // required for Attestation mode
    delegation: undefined,                  // required for Delegated mode
  },
});

// Close receipt PDA and reclaim rent
const closeIx = await buildCloseReceiptIx({
  program,
  payer: wallet.publicKey,
  receipt: receiptPda,
});
```

### Settlement Modes

| Mode | Description | Signers |
|------|------------|---------|
| **Atomic** | Real SPL token transfer on-chain | Payer signs |
| **Attestation** | Off-chain payment proof, facilitator co-signs | Payer + facilitator |
| **Delegated** | Funds from delegation vault, delegation required | Caller with delegation |

---

## Account Fetchers

Read on-chain accounts with type-safe return values.

### Single Account

```typescript
import {
  fetchProtocolConfig,
  fetchAgentIdentity,
  fetchAgentIdentityOrNull,
  fetchService,
  fetchFeedbackEntry,
  fetchDelegation,
  fetchDelegationByPda,
  fetchPaymentRequirement,
} from "@x84-ai/sdk";

const config = await fetchProtocolConfig(program);
const agent = await fetchAgentIdentity(program, agentMint);
const agentOrNull = await fetchAgentIdentityOrNull(program, agentMint);
const service = await fetchService(program, agentMint, ServiceType.A2A);
const feedback = await fetchFeedbackEntry(program, agentMint, reviewerPubkey, 0);
const delegation = await fetchDelegation(program, delegator, delegate, delegationId);
const delegation2 = await fetchDelegationByPda(program, delegationPda);
const payReq = await fetchPaymentRequirement(program, agentMint, ServiceType.A2A);
```

### Batch Fetchers (getProgramAccounts with memcmp)

```typescript
import {
  fetchAllAgents,
  fetchAgentsByOwner,
  fetchServicesByAgent,
  fetchFeedbacksByAgent,
  fetchDelegationsByDelegate,
  fetchDelegationsByAgent,
} from "@x84-ai/sdk";

const allAgents = await fetchAllAgents(program);
const myAgents = await fetchAgentsByOwner(program, wallet.publicKey);
const services = await fetchServicesByAgent(program, agentMint);
const feedback = await fetchFeedbacksByAgent(program, agentMint);
const delegations = await fetchDelegationsByDelegate(program, delegatePubkey);
const agentDelegations = await fetchDelegationsByAgent(program, agentMint);
```

---

## PDA Derivation Helpers

All functions return `[PublicKey, number]` (address + bump).

```typescript
import {
  findConfigPda,
  findAgentPda,
  findServicePda,
  findFeedbackPda,
  findDelegationPda,
  findPaymentReqPda,
  findReceiptPda,
  findVaultPda,
  findVaultAuthorityPda,
  findValidationRequestPda,
  findValidationResponsePda,
} from "@x84-ai/sdk";

// Seeds shown for reference
findConfigPda()                                        // ["config"]
findAgentPda(nftMint)                                  // ["agent", nft_mint]
findServicePda(nftMint, "a2a")                         // ["service", nft_mint, "a2a"]
findFeedbackPda(nftMint, reviewer, nonce)              // ["feedback", nft_mint, reviewer, nonce_le_bytes]
findDelegationPda(delegator, delegate, delegationId)   // ["delegation", delegator, delegate, id_le_bytes]
findPaymentReqPda(nftMint, "a2a")                      // ["payment_req", nft_mint, "a2a"]
findReceiptPda(paymentId)                              // ["receipt", payment_id]
findVaultPda(delegationPda)                            // ["delegation_vault", delegation_pda]
findVaultAuthorityPda(delegationPda)                   // ["vault_authority", delegation_pda]
findValidationRequestPda(nftMint, validator, hash)     // ["val_request", nft_mint, validator, hash[0..8]]
findValidationResponsePda(nftMint, validator, hash)    // ["val_response", nft_mint, validator, hash[0..8]]
```

---

## Event Parsing

Parse protocol events from transaction logs. 18 event types.

```typescript
import { parseEventsFromTx, parseEventsFromLogs, findEvent } from "@x84-ai/sdk";

// From a confirmed transaction signature
const events = await parseEventsFromTx(program, connection, txSignature);

// From raw log strings
const events = parseEventsFromLogs(program, logs);

// Find a specific event
const registered = findEvent(events, "AgentRegisteredEvent");
```

### Event Types

| Event | Emitted by |
|-------|-----------|
| `AgentRegisteredEvent` | `registerAgent` |
| `MetadataUpdatedEvent` | `updateAgentMetadata` |
| `AgentDeactivatedEvent` | `deactivateAgent` |
| `AgentReactivatedEvent` | `reactivateAgent` |
| `AgentClaimedEvent` | `claimAgent` |
| `FeedbackAuthorityUpdatedEvent` | `setFeedbackAuthority` |
| `ServiceAddedEvent` | `addService` |
| `ServiceUpdatedEvent` | `updateService` |
| `ServiceRemovedEvent` | `removeService` |
| `FeedbackGivenEvent` | `giveFeedback` |
| `FeedbackRevokedEvent` | `revokeFeedback` |
| `ValidationRequestedEvent` | `validationRequest` |
| `ValidationRespondedEvent` | `validationResponse` |
| `DelegationCreatedEvent` | `createDelegation` / `DelegationBuilder.build` |
| `DelegationRevokedEvent` | `revokeDelegation` |
| `PaymentRequirementSetEvent` | `setPaymentRequirement` |
| `PaymentSettledEvent` | `buildVerifyAndSettleIx` |

---

## Error Handling

51 protocol error codes (6000–6050) with human-readable messages.

```typescript
import { parseX84Error } from "@x84-ai/sdk";

try {
  await program.methods.registerAgent(...).rpc();
} catch (err) {
  const x84Error = parseX84Error(err);
  if (x84Error) {
    console.log(x84Error.code);    // e.g. 6012
    console.log(x84Error.name);    // e.g. "Unauthorized"
    console.log(x84Error.message); // human-readable explanation
  }
}
```

### Error Codes Quick Reference

| Range | Category | Examples |
|-------|----------|---------|
| 6000–6004 | Field length | MetadataUriTooLong, EndpointTooLong |
| 6005–6006 | Score validation | InvalidFeedbackScore, InvalidValidationScore |
| 6007–6009 | Array limits | TooManyTags, TooManyAllowedTokens |
| 6010–6011 | Agent status | AgentInactive, AgentAlreadyActive |
| 6012–6013 | Authorization | Unauthorized, InvalidFeedbackAuth |
| 6014 | Feedback | FeedbackAlreadyRevoked |
| 6015–6026 | Delegation | DelegationExpired, InsufficientPermission, MaxDelegationDepthExceeded |
| 6027–6029 | Payment | PaymentRequirementInactive, InsufficientPayment, PaymentReplay |
| 6030 | Service | ServiceAlreadyExists |
| 6031 | NFT | NotNftHolder |
| 6032–6033 | Validation | ValidationAlreadyResponded, ValidatorMismatch |
| 6034 | Module | ModulePaused |
| 6035–6050 | Settlement | SettlementFeeTooHigh, FacilitatorRequired, TokenMintMismatch, MathOverflow |

---

## Utility Functions

Browser-safe cryptographic helpers (uses `@noble/hashes`, `crypto.getRandomValues`).

```typescript
import {
  hashTag,
  hashBytes,
  zeroBytes32,
  zeroBytes64,
  randomPaymentId,
  randomSignature,
  stringToBytes32,
} from "@x84-ai/sdk";

hashTag("oracle")                         // SHA-256 hash of string → number[] (32 bytes)
hashBytes(data: Uint8Array)               // SHA-256 hash of bytes → number[] (32 bytes)
zeroBytes32()                             // 32 zero bytes
zeroBytes64()                             // 64 zero bytes
randomPaymentId()                         // 32 random bytes for payment ID
randomSignature()                         // 64 random bytes (signature placeholder)
stringToBytes32("hello")                  // string → 32-byte zero-padded array
```

---

## REST API Client

Zero-dependency HTTP client for the x84 REST API. Uses native `fetch`.

```typescript
import { X84ApiClient } from "@x84-ai/sdk/api";

// Connect to network
const api = new X84ApiClient();                                  // mainnet default
const api = new X84ApiClient({ network: "devnet" });            // devnet
const api = new X84ApiClient({ baseUrl: "http://localhost:3001" }); // custom

// Discovery
const { data, cursor } = await api.listAgents({ category: "defi", limit: 20, q: "oracle" });
const agent = await api.getAgent(agentMintString);
const services = await api.getAgentServices(agentMintString, { serviceType: "a2a" });
const feedback = await api.getAgentFeedback(agentMintString, { verified: true });
const categories = await api.listCategories();

// Registration (co-signed by backend)
const result = await api.registerAgent({
  name: "My Agent",
  ownerAddress: walletPubkeyString,
  metadataUri: "https://example.com/metadata.json",
  tags: ["oracle"],
});
// Returns: { transaction (base64), asset, agentPda, blockhash, lastValidBlockHeight }
// The transaction needs to be signed by the owner wallet and submitted.
```

### API Response Types

```typescript
interface AgentListItem {
  mint: string;
  name: string;
  owner: string;
  metadataUri: string;
  active: boolean;
  reputation: ReputationSummary;
  createdAt: string;
}

interface ReputationSummary {
  verifiedCount: number;
  averageScore: number;
  unverifiedCount: number;
  validationCount: number;
}

interface PaginatedResponse<T> {
  data: T[];
  cursor: { next: string | null; hasMore: boolean };
}
```
