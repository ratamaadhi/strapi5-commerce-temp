# Manual Bank Transfer Payment — Design

**Date:** 2026-07-19
**Status:** Approved for planning

## Problem

Clients who don't yet have payment gateway (Midtrans) access still need to sell. Manual bank transfer lets a customer pay by transferring to the store's bank account, upload proof of payment, and have a store admin verify it. On approval the order is marked paid; on rejection the customer uploads a new valid proof. Unlimited retries.

## Goals

- Customer can create an order that will be paid by manual transfer.
- Customer uploads payment proof (image); can re-upload after rejection, unlimited times.
- Store admin verifies proof from the Strapi admin panel and approves or rejects it.
- Approval marks the order paid; rejection keeps it payable so the customer can retry.
- Store owner can hold multiple bank accounts and toggle which payment methods are active.
- Unpaid manual orders expire after 24h, are cancelled, and their stock is returned.

## Non-Goals

- No custom admin-panel plugin/UI. Admins act via native Strapi record editing.
- No automated bank-statement reconciliation. Verification is human.
- No changes to the existing Midtrans gateway flow.
- No frontend (this repo is backend only).

## Key Decisions (from brainstorming)

- **Separate `manual-payment` entity**, not new states on `order.paymentStatus`. Keeps gateway semantics clean and holds a self-contained verification lifecycle. `order.paymentStatus` stays coarse (`pending | paid | failed | refunded | cancelled`).
- **`payment-proof` repeatable per attempt** — full history of every upload and every reject reason, for audit / fraud pattern detection.
- Each proof carries **image + metadata + snapshot of the chosen destination bank account** (text, not a relation) so old proofs stay correct if bank accounts are later edited or removed.
- **Bank accounts live in `store-setting`** as a repeatable component; proofs snapshot them.
- **Approve/reject via lifecycle hook** on `manual-payment` — admin edits the record's `status` field in the panel, hook applies side effects. No custom admin endpoints for the decision.
- **Payment-method toggles in `store-setting`** (`gatewayEnabled`, `manualTransferEnabled`); enforced server-side at order creation.
- **`manual-payment` auto-created via order `afterCreate`** lifecycle when `paymentMethod = manual_transfer`.
- **Destination bank account chosen at proof-upload time** (not checkout).
- On approve, **order stays at admin-controlled `orderStatus`** — only `paymentStatus` moves to `paid`. Admin advances `orderStatus` manually.

## Data Model

### `order` (extend existing)

Add:

- `paymentMethod`: enum `gateway | manual_transfer`, default `gateway`. Default keeps existing orders valid.
- `manualPayment`: relation `oneToOne` → `api::manual-payment.manual-payment` (inverse of `manual-payment.order`).

Existing `paymentStatus`, `paidAt`, stock decrement/rollback logic, and Midtrans fields are unchanged.

### `manual-payment` (new collectionType)

- `order`: relation `oneToOne` → `api::order.order` (owner side).
- `status`: enum `awaiting_proof | under_review | approved | rejected`, default `awaiting_proof`.
- `expectedAmount`: decimal — snapshot of `order.totalAmount` at creation.
- `rejectionReason`: text — reason for the latest rejection (set by admin).
- `reviewedAt`: datetime — when the latest decision was made.
- `proofs`: component `payment.payment-proof`, repeatable.

State machine (per order, one record):

```
awaiting_proof ──customer uploads──▶ under_review
under_review ──admin approve──▶ approved   (terminal)
under_review ──admin reject──▶  rejected
rejected ──customer re-uploads──▶ under_review
```

`approved` is terminal. `rejected` is not — a new upload moves it back to `under_review`. Unlimited retries.

### `payment.payment-proof` (new component)

- `image`: media (single, images only) — the proof.
- `senderName`: string — account holder who transferred.
- `senderBank`: string — sender's bank.
- `transferAmount`: decimal — amount the customer says they transferred.
- `transferDate`: datetime.
- `referenceNote`: string — transfer reference / berita.
- `destinationBankName`: string — snapshot of chosen store bank name.
- `destinationAccountNumber`: string — snapshot of chosen store account number.
- `proofStatus`: enum `pending | approved | rejected`, default `pending`.
- `submittedAt`: datetime.

The latest proof's `proofStatus` mirrors the parent `manual-payment.status` decision; older proofs keep their historical status.

### `store-setting` (extend existing singleType)

Add:

- `gatewayEnabled`: boolean, default `true`.
- `manualTransferEnabled`: boolean, default `false`.
- `bankAccounts`: component `payment.bank-account`, repeatable.

### `payment.bank-account` (new component)

- `bankName`: string, required.
- `accountNumber`: string, required.
- `accountHolder`: string, required.
- `isActive`: boolean, default `true`. Inactive = hidden from new customers, still valid for existing orders (proofs already snapshot the data).

## API / Endpoints

### Public (customer)

- `GET /store-setting/payment-methods` — returns enabled methods and, if manual is enabled, the list of **active** bank accounts only. Never exposes inactive accounts. Drives checkout rendering.
- `POST /manual-payments/:orderId/proofs` — customer uploads a proof (image + metadata + chosen destination bank).
  - **Guard:** the order must belong to `ctx.state.user`. Reject others.
  - **Guard:** the order's `manual-payment.status` must not be `approved` (idempotent; no upload after paid).
  - **File validation:** `image/jpeg|png|webp` only, max 5MB. Reject anything else.
  - Appends a `payment-proof` (`proofStatus = pending`), sets `manual-payment.status = under_review`.

### Order creation (extend existing)

At order create, if `paymentMethod = manual_transfer`:
- **Enforce** `store-setting.manualTransferEnabled === true`, else `400`. Likewise reject a `gateway` order if `gatewayEnabled === false`. Never trust the frontend.
- Stock is decremented in the existing create flow (unchanged).
- `afterCreate` lifecycle creates the linked `manual-payment` (`status = awaiting_proof`, `expectedAmount = totalAmount`).

### Admin (native Strapi panel)

No custom endpoints. Admin opens the `manual-payment` record and sets `status`:
- `approved` (+ optionally advances `orderStatus` separately).
- `rejected` + fills `rejectionReason`.

## Lifecycle Hooks

### `order.afterCreate`

If `paymentMethod = manual_transfer` and no `manual-payment` exists, create one: `status = awaiting_proof`, `expectedAmount = totalAmount`, linked to the order.

### `manual-payment.afterUpdate`

On a `status` transition:
- → `approved`: set `order.paymentStatus = paid`, `order.paidAt = now`, `manual-payment.reviewedAt = now`, stamp the latest proof `proofStatus = approved`. Leave `orderStatus` untouched. Idempotent — no-op if already `paid`.
- → `rejected`: set `manual-payment.reviewedAt = now`, stamp latest proof `proofStatus = rejected`. `order.paymentStatus` stays `pending` (not `failed` — customer may retry).

Guard against double-approve: if the order is already `paid`, ignore further approve transitions.

## Expiry (cron)

- Enable cron: `config/server.ts` → `cron: { enabled: env.bool('CRON_ENABLED', false) }`. Register tasks in server config from `config/cron-tasks.ts`.
- Task runs hourly (`rule: "0 * * * *"`).
- Finds `manual-payment` records with `status in (awaiting_proof, under_review)` whose linked order was created > 24h ago and `paymentStatus = pending`.
- For each: set `order.orderStatus = cancelled`, `order.paymentStatus = cancelled`, and **return stock** using the existing `incrementVariantInventory` / product-inventory raw update helpers (mirrors the current cancel/rollback path).

## Security

- Proof upload is owner-scoped (`ctx.state.user` must own the order).
- File type + size validation on upload.
- Verification decisions are admin-panel only (Strapi admin role), not exposed to users-permissions users.
- State guards make approve idempotent and block post-approval uploads.
- Bank-account list endpoint returns active accounts only.
- Server-side enforcement of enabled payment methods at order creation.

## Testing

- **Model/lifecycle:** order `afterCreate` creates `manual-payment` with correct snapshot; approve/reject side effects on `order`; double-approve is a no-op; reject keeps order payable.
- **Upload controller:** ownership guard rejects foreign orders; file type/size rejection; upload blocked after approval; new upload flips `rejected → under_review`.
- **Store-setting:** payment-methods endpoint hides inactive accounts and disabled methods.
- **Order creation:** manual order rejected when `manualTransferEnabled = false`.
- **Cron:** order older than 24h + unpaid gets cancelled and stock returned; paid/recent orders untouched.

## Open Follow-ups (out of scope)

- Both methods disabled → checkout has no method. Admin awareness only; hard validation later.
- Customer-facing notification (email/WhatsApp) on approve/reject — future.
