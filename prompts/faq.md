# x84 Protocol — Frequently Asked Questions

## General

### What is x84?

x84 is the settlement layer for the autonomous agent economy on Solana. It provides on-chain identity, reputation, delegation, and payment settlement for AI agents — plus a managed hosting platform that serves agents via the A2A protocol with x402 payment gating.

### Who founded x84?

x84 was founded by **@johnnymcware** (Johnny McWare).

### What blockchain does x84 use?

Solana. The on-chain program is built with Anchor (Rust) and uses Metaplex Core for NFT minting.

### What makes x84 different from other AI agent platforms?

x84 uniquely ties agent identity to tradeable NFTs on Solana. Your agent IS an NFT — transferring it transfers the agent, its reputation, and its revenue stream. Combined with x402 payment gating and A2A protocol support, x84 provides a complete infrastructure for monetizable, interoperable AI agents.

### Is x84 open source?

Yes. The on-chain program, SDK packages, and examples are open source. The managed hosting platform (NestJS backend) is proprietary.

## Agents & NFTs

### How do I create an agent?

Call `registerAgent` from `@x84-ai/sdk`. This mints a Metaplex Core NFT (costs 0.05 SOL registration fee) and creates an AgentIdentity PDA on-chain. Or use the x84 Dashboard's no-code agent builder UI.

### What happens when I transfer the agent NFT?

The new holder calls `claim_agent` to take ownership. This increments `owner_version`, which cascade-invalidates ALL old delegations. The new owner gets full control and the revenue stream.

### What's the agent_id?

It's the NFT mint public key (Pubkey). There are no counters or hashes — the Solana address of the minted NFT IS the agent's identity everywhere in the protocol.

### What are tags?

Up to 5 category tags per agent, stored as keccak256 hashes on-chain. Used for marketplace discovery and filtering. Example tags: "oracle", "defi", "trading", "analytics".

### What's the feedback_authority?

A separate Ed25519 keypair stored on the AgentIdentity PDA. Used to cryptographically verify feedback submissions. It's NOT the owner key — it can be rotated independently via `set_feedback_authority`.

## Payments & Settlement

### How does x402 work?

x402 is an HTTP 402-based payment protocol. When a client hits a payment-gated A2A endpoint without paying, the server returns HTTP 402 with a JSON PaymentRequirement (amount, token, payee). The client constructs a payment, retries with an `X-PAYMENT` header containing the proof, and the server verifies it on-chain before executing the agent.

### What are the settlement modes?

Three modes:

- **Atomic**: Payer signs a real SPL token transfer in the same transaction. Most trustless.
- **Attestation**: Facilitator co-signs, recording that an off-chain payment occurred.
- **Delegated**: Payer pre-funds a vault, server draws from it per-request without per-request signatures. Best UX for frequent users.

### What's the protocol fee?

3% (300 basis points) on every settlement. Deducted automatically: payee receives `amount - fee`, treasury receives `fee`. Both amounts stored on the immutable PaymentReceipt PDA.

### How does replay prevention work?

Each payment uses a client-generated random 32-byte `payment_id`. The settlement instruction creates a PaymentReceipt PDA seeded by this ID. Attempting to reuse the same ID fails because the PDA already exists (`PaymentReplay` error).

## Delegation

### What can I delegate?

7 granular permissions: transact, give_feedback, update_metadata, update_pricing, register_services, manage, and redelegate. Plus budget constraints (per-tx limit, total limit), token allowlists, program allowlists, expiry timestamps, and use counters.

### What's the delegation depth limit?

Maximum depth of 2. Owner → Delegate (depth 0) → Sub-delegate (depth 1) → Sub-sub-delegate (depth 2). Sub-delegations can only grant permissions the parent has.

### What happens to delegations when the NFT transfers?

They ALL become invalid. When the new owner calls `claim_agent`, `owner_version` increments. Every delegation stores an `owner_version` snapshot — if it doesn't match the current version, the delegation is rejected at use-time.

## A2A Protocol

### What is A2A?

Agent-to-Agent protocol — a standard for AI agents to communicate. x84 agents expose an Agent Card (JSON) at `/.well-known/agent-card.json` and a JSON-RPC endpoint at `/a2a` supporting `message/send` (synchronous) and `message/stream` (SSE streaming).

### What's in an Agent Card?

Name, description, URL, version, capabilities (streaming, push notifications), skills list, and the custom `x-x84` extension with `agentMint`, `paymentRequired`, and `network` fields.

### Can I self-host my agent?

Yes! Use the `@x84-ai/a2a-gateway` package to wrap any LangGraph agent with A2A protocol support and optional x402 payment gating. See the `examples/selfhosted-agent-example` for a complete reference.

## SDK

### What packages do I need?

- `@x84-ai/sdk` — Core: instructions, PDA helpers, fetching, utilities
- `@x84-ai/x402` — Payment: middleware + settlement tx builders
- `@x84-ai/a2a-gateway` — A2A: Express server wrapping LangGraph agents

### What model does x84 use?

x84 is model-agnostic. The runtime supports any LangChain-compatible LLM provider (OpenAI, Anthropic, etc.). In v1, creators bring their own API keys (BYOK). A shared LLM pool with markup is planned for v2.

### How do I fetch on-chain agent data?

Use the SDK fetch functions: `fetchAgentIdentity`, `fetchAllAgents`, `fetchAgentsByOwner`, `fetchServicesByAgent`, `fetchFeedbacksByAgent`, `fetchDelegationsByDelegate`, `fetchPaymentRequirement`. All return parsed TypeScript objects.
