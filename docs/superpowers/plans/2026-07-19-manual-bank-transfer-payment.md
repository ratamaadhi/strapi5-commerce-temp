# Manual Bank Transfer Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let customers pay by manual bank transfer — upload proof, admin verifies from the Strapi panel, approval marks the order paid; unpaid orders expire after 24h and return stock.

**Architecture:** A separate `manual-payment` collectionType holds a verification lifecycle linked one-to-one to `order`, with a repeatable `payment-proof` component per upload attempt. Pure decision logic (method resolution, file validation, approval side effects, expiry predicate) lives in a testable service module; Strapi lifecycles and a custom upload controller are thin glue over it. Admins approve/reject by editing the record's `status` field, handled by an `afterUpdate` lifecycle. An hourly cron task cancels expired orders.

**Tech Stack:** Strapi 5.47 (TypeScript), Knex raw SQL for inventory, `node:test` + `tsx --test` for unit tests, existing `@strapi/plugin-upload` (S3) for proof images, existing cron infrastructure (`config/cron-tasks.ts`).

## Global Constraints

- Strapi version: 5.47.0. Follow existing API structure (`content-types`, `controllers`, `routes`, `services` per api).
- Currency default `IDR`; money fields are `decimal`.
- `order.paymentStatus` enum stays coarse: `pending | paid | failed | refunded | cancelled` — do NOT add states to it.
- Proof files: images only (`image/jpeg`, `image/png`, `image/webp`), max 5MB.
- Manual payment TTL: 24 hours.
- Do not modify the existing Midtrans gateway flow.
- Inventory restore uses existing helpers in `src/api/order/services/inventory.ts` (`incrementVariantInventory(strapi, sku, documentId, qty)`) and the raw `UPDATE products SET inventory = inventory + :qty WHERE document_id = :documentId` fallback for non-variant items.
- Tests are pure-unit against service modules, run with `tsx --test` (mirror `tests/analytics-utils.test.ts`).

---

## File Structure

**Create:**
- `src/components/payment/bank-account.json` — store bank account component.
- `src/components/payment/payment-proof.json` — per-attempt proof component.
- `src/api/manual-payment/content-types/manual-payment/schema.json` — new collectionType.
- `src/api/manual-payment/content-types/manual-payment/lifecycles.ts` — approve/reject side effects.
- `src/api/manual-payment/services/manual-payment.ts` — core service factory.
- `src/api/manual-payment/services/logic.ts` — pure, tested decision logic.
- `src/api/manual-payment/services/expiry.ts` — cron expiry runner (glue over `logic.ts`).
- `src/api/manual-payment/controllers/manual-payment.ts` — proof upload controller.
- `src/api/manual-payment/routes/manual-payment.ts` — custom upload route.
- `src/api/manual-payment/routes/core.ts` — core router (admin CRUD in panel).
- `src/api/store-setting/routes/payment-methods.ts` — public payment-methods route.
- `tests/manual-payment-logic.test.ts` — unit tests for `logic.ts`.

**Modify:**
- `src/api/order/content-types/order/schema.json` — add `paymentMethod`, `manualPayment` relation.
- `src/api/order/content-types/order/lifecycles.ts` — enforce enabled method (beforeCreate), auto-create manual-payment (afterCreate).
- `src/api/store-setting/content-types/store-setting/schema.json` — add `gatewayEnabled`, `manualTransferEnabled`, `bankAccounts`.
- `src/api/store-setting/controllers/store-setting.ts` — add `paymentMethods` handler.
- `config/cron-tasks.ts` — add `manualPaymentExpiry` task.
- `package.json` — add `test:manual-payment` script.

---

## Task 1: Payment components (bank-account, payment-proof)

**Files:**
- Create: `src/components/payment/bank-account.json`
- Create: `src/components/payment/payment-proof.json`

**Interfaces:**
- Produces: components `payment.bank-account` and `payment.payment-proof`, consumed by Tasks 2 and 3.

- [ ] **Step 1: Create the bank-account component**

`src/components/payment/bank-account.json`:

```json
{
  "collectionName": "components_payment_bank_accounts",
  "info": {
    "displayName": "bankAccount",
    "icon": "wallet"
  },
  "options": {},
  "attributes": {
    "bankName": { "type": "string", "required": true },
    "accountNumber": { "type": "string", "required": true },
    "accountHolder": { "type": "string", "required": true },
    "isActive": { "type": "boolean", "default": true }
  }
}
```

- [ ] **Step 2: Create the payment-proof component**

`src/components/payment/payment-proof.json`:

```json
{
  "collectionName": "components_payment_payment_proofs",
  "info": {
    "displayName": "paymentProof",
    "icon": "picture"
  },
  "options": {},
  "attributes": {
    "image": {
      "type": "media",
      "multiple": false,
      "required": true,
      "allowedTypes": ["images"]
    },
    "senderName": { "type": "string" },
    "senderBank": { "type": "string" },
    "transferAmount": { "type": "decimal" },
    "transferDate": { "type": "datetime" },
    "referenceNote": { "type": "string" },
    "destinationBankName": { "type": "string" },
    "destinationAccountNumber": { "type": "string" },
    "proofStatus": {
      "type": "enumeration",
      "enum": ["pending", "approved", "rejected"],
      "default": "pending"
    },
    "submittedAt": { "type": "datetime" }
  }
}
```

- [ ] **Step 3: Verify schemas load**

Run: `npm run build`
Expected: build completes with no schema validation error.

- [ ] **Step 4: Commit**

```bash
git add src/components/payment/
git commit -m "feat(payment): add bank-account and payment-proof components"
```

---

## Task 2: manual-payment content-type + order schema wiring

**Files:**
- Create: `src/api/manual-payment/content-types/manual-payment/schema.json`
- Create: `src/api/manual-payment/services/manual-payment.ts`
- Create: `src/api/manual-payment/routes/core.ts`
- Modify: `src/api/order/content-types/order/schema.json`

**Interfaces:**
- Consumes: components from Task 1.
- Produces: `api::manual-payment.manual-payment` with fields `status`, `expectedAmount`, `rejectionReason`, `reviewedAt`, `proofs`, `order`; and `order.manualPayment` (oneToOne inverse), `order.paymentMethod` enum. Consumed by Tasks 5–9.

- [ ] **Step 1: Create the manual-payment schema**

`src/api/manual-payment/content-types/manual-payment/schema.json`:

```json
{
  "kind": "collectionType",
  "collectionName": "manual_payments",
  "info": {
    "singularName": "manual-payment",
    "pluralName": "manual-payments",
    "displayName": "Manual Payment"
  },
  "options": { "draftAndPublish": false },
  "pluginOptions": {},
  "attributes": {
    "status": {
      "type": "enumeration",
      "enum": ["awaiting_proof", "under_review", "approved", "rejected"],
      "default": "awaiting_proof"
    },
    "expectedAmount": { "type": "decimal", "default": 0 },
    "rejectionReason": { "type": "text" },
    "reviewedAt": { "type": "datetime" },
    "order": {
      "type": "relation",
      "relation": "oneToOne",
      "target": "api::order.order",
      "inversedBy": "manualPayment"
    },
    "proofs": {
      "type": "component",
      "component": "payment.payment-proof",
      "repeatable": true
    }
  }
}
```

- [ ] **Step 2: Create the core service**

`src/api/manual-payment/services/manual-payment.ts`:

```ts
import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::manual-payment.manual-payment');
```

- [ ] **Step 3: Create the core router (panel CRUD)**

`src/api/manual-payment/routes/core.ts`:

```ts
import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::manual-payment.manual-payment');
```

- [ ] **Step 4: Add paymentMethod and manualPayment relation to order schema**

In `src/api/order/content-types/order/schema.json`, add these two attributes inside `attributes` (place `paymentMethod` after `currency`, `manualPayment` near the other relations):

```json
    "paymentMethod": {
      "type": "enumeration",
      "enum": ["gateway", "manual_transfer"],
      "default": "gateway"
    },
    "manualPayment": {
      "type": "relation",
      "relation": "oneToOne",
      "target": "api::manual-payment.manual-payment",
      "mappedBy": "order"
    }
```

- [ ] **Step 5: Verify schemas load and relation resolves**

Run: `npm run build`
Expected: build completes; no "target not found" or relation error.

- [ ] **Step 6: Commit**

```bash
git add src/api/manual-payment/content-types src/api/manual-payment/services/manual-payment.ts src/api/manual-payment/routes/core.ts src/api/order/content-types/order/schema.json
git commit -m "feat(manual-payment): add manual-payment content-type and order wiring"
```

---

## Task 3: store-setting schema extension

**Files:**
- Modify: `src/api/store-setting/content-types/store-setting/schema.json`

**Interfaces:**
- Consumes: `payment.bank-account` from Task 1.
- Produces: `store-setting.gatewayEnabled`, `store-setting.manualTransferEnabled`, `store-setting.bankAccounts`. Consumed by Tasks 4–6.

- [ ] **Step 1: Add attributes to store-setting**

In `src/api/store-setting/content-types/store-setting/schema.json`, add inside `attributes` (after `whatsappNumber`):

```json
    "gatewayEnabled": { "type": "boolean", "default": true },
    "manualTransferEnabled": { "type": "boolean", "default": false },
    "bankAccounts": {
      "type": "component",
      "component": "payment.bank-account",
      "repeatable": true
    }
```

- [ ] **Step 2: Verify schema loads**

Run: `npm run build`
Expected: build completes with no schema error.

- [ ] **Step 3: Commit**

```bash
git add src/api/store-setting/content-types/store-setting/schema.json
git commit -m "feat(store-setting): add payment method toggles and bank accounts"
```

---

## Task 4: Pure decision logic + unit tests

**Files:**
- Create: `src/api/manual-payment/services/logic.ts`
- Create: `tests/manual-payment-logic.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces (consumed by Tasks 5–9):
  - `resolvePaymentMethods(setting): PaymentMethodsView`
  - `isPaymentMethodEnabled(method: 'gateway' | 'manual_transfer', setting): boolean`
  - `validateProofFile(file): { ok: true } | { ok: false; error: string }`
  - `computeApprovalEffects(newStatus, currentOrderPaymentStatus): { markPaid: boolean; stampProof: 'approved' | 'rejected' | null }`
  - `isManualPaymentExpired(order, manualStatus, now?, ttlHours?): boolean`
  - constants `PROOF_MAX_BYTES`, `PROOF_ALLOWED_MIME`, `MANUAL_PAYMENT_TTL_HOURS`

- [ ] **Step 1: Write the failing test**

`tests/manual-payment-logic.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePaymentMethods,
  isPaymentMethodEnabled,
  validateProofFile,
  computeApprovalEffects,
  isManualPaymentExpired,
  PROOF_MAX_BYTES,
} from '../src/api/manual-payment/services/logic';

test('resolvePaymentMethods defaults gateway on, manual off, hides banks', () => {
  const r = resolvePaymentMethods({});
  assert.equal(r.gateway, true);
  assert.equal(r.manualTransfer, false);
  assert.deepEqual(r.bankAccounts, []);
});

test('resolvePaymentMethods exposes only active banks when manual on', () => {
  const r = resolvePaymentMethods({
    manualTransferEnabled: true,
    bankAccounts: [
      { bankName: 'BCA', accountNumber: '123', accountHolder: 'Toko', isActive: true },
      { bankName: 'BNI', accountNumber: '999', accountHolder: 'Toko', isActive: false },
    ],
  });
  assert.equal(r.manualTransfer, true);
  assert.deepEqual(r.bankAccounts, [
    { bankName: 'BCA', accountNumber: '123', accountHolder: 'Toko' },
  ]);
});

test('resolvePaymentMethods hides banks when manual disabled', () => {
  const r = resolvePaymentMethods({
    manualTransferEnabled: false,
    bankAccounts: [{ bankName: 'BCA', accountNumber: '123', accountHolder: 'Toko', isActive: true }],
  });
  assert.deepEqual(r.bankAccounts, []);
});

test('isPaymentMethodEnabled enforces toggles', () => {
  assert.equal(isPaymentMethodEnabled('manual_transfer', { manualTransferEnabled: true }), true);
  assert.equal(isPaymentMethodEnabled('manual_transfer', { manualTransferEnabled: false }), false);
  assert.equal(isPaymentMethodEnabled('gateway', {}), true);
  assert.equal(isPaymentMethodEnabled('gateway', { gatewayEnabled: false }), false);
});

test('validateProofFile accepts a small jpeg', () => {
  assert.deepEqual(validateProofFile({ mime: 'image/jpeg', size: 1000 }), { ok: true });
});

test('validateProofFile rejects missing file', () => {
  const r = validateProofFile(null);
  assert.equal(r.ok, false);
});

test('validateProofFile rejects wrong mime', () => {
  const r = validateProofFile({ mime: 'application/pdf', size: 1000 });
  assert.equal(r.ok, false);
});

test('validateProofFile rejects oversize file', () => {
  const r = validateProofFile({ mime: 'image/png', size: PROOF_MAX_BYTES + 1 });
  assert.equal(r.ok, false);
});

test('computeApprovalEffects marks paid on first approval', () => {
  assert.deepEqual(computeApprovalEffects('approved', 'pending'), { markPaid: true, stampProof: 'approved' });
});

test('computeApprovalEffects is idempotent when already paid', () => {
  assert.deepEqual(computeApprovalEffects('approved', 'paid'), { markPaid: false, stampProof: null });
});

test('computeApprovalEffects on reject stamps proof, no paid', () => {
  assert.deepEqual(computeApprovalEffects('rejected', 'pending'), { markPaid: false, stampProof: 'rejected' });
});

test('computeApprovalEffects ignores non-terminal transitions', () => {
  assert.deepEqual(computeApprovalEffects('under_review', 'pending'), { markPaid: false, stampProof: null });
});

test('isManualPaymentExpired true when pending and older than ttl', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  const order = { createdAt: '2026-07-18T11:00:00Z', paymentStatus: 'pending' };
  assert.equal(isManualPaymentExpired(order, 'awaiting_proof', now), true);
});

test('isManualPaymentExpired false when recent', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  const order = { createdAt: '2026-07-19T10:00:00Z', paymentStatus: 'pending' };
  assert.equal(isManualPaymentExpired(order, 'under_review', now), false);
});

test('isManualPaymentExpired false when already paid', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  const order = { createdAt: '2026-07-17T10:00:00Z', paymentStatus: 'paid' };
  assert.equal(isManualPaymentExpired(order, 'approved', now), false);
});
```

- [ ] **Step 2: Add the test script and run to verify it fails**

In `package.json` `scripts`, add:

```json
    "test:manual-payment": "tsx --test tests/manual-payment-logic.test.ts"
```

Run: `npm run test:manual-payment`
Expected: FAIL — cannot find module `../src/api/manual-payment/services/logic`.

- [ ] **Step 3: Write the implementation**

`src/api/manual-payment/services/logic.ts`:

```ts
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PROOF_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
export const MANUAL_PAYMENT_TTL_HOURS = 24;

export interface BankAccount {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  isActive?: boolean;
}

export interface PaymentMethodsView {
  gateway: boolean;
  manualTransfer: boolean;
  bankAccounts: Array<Pick<BankAccount, 'bankName' | 'accountNumber' | 'accountHolder'>>;
}

export type PaymentMethod = 'gateway' | 'manual_transfer';
export type ManualPaymentStatus = 'awaiting_proof' | 'under_review' | 'approved' | 'rejected';

interface StoreSettingLike {
  gatewayEnabled?: boolean;
  manualTransferEnabled?: boolean;
  bankAccounts?: BankAccount[];
}

export function resolvePaymentMethods(setting: StoreSettingLike): PaymentMethodsView {
  const gateway = setting?.gatewayEnabled !== false; // default true
  const manualTransfer = setting?.manualTransferEnabled === true;
  const bankAccounts = manualTransfer
    ? (setting?.bankAccounts ?? [])
        .filter((b) => b.isActive !== false)
        .map(({ bankName, accountNumber, accountHolder }) => ({
          bankName,
          accountNumber,
          accountHolder,
        }))
    : [];
  return { gateway, manualTransfer, bankAccounts };
}

export function isPaymentMethodEnabled(method: PaymentMethod, setting: StoreSettingLike): boolean {
  if (method === 'manual_transfer') return setting?.manualTransferEnabled === true;
  return setting?.gatewayEnabled !== false;
}

interface ProofFileLike {
  mime?: string;
  type?: string;
  size?: number;
}

export function validateProofFile(
  file: ProofFileLike | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!file) return { ok: false, error: 'Bukti pembayaran wajib diunggah' };
  const mime = file.mime ?? file.type ?? '';
  if (!PROOF_ALLOWED_MIME.includes(mime)) {
    return { ok: false, error: 'Format file harus JPEG, PNG, atau WEBP' };
  }
  if ((file.size ?? 0) > PROOF_MAX_BYTES) {
    return { ok: false, error: 'Ukuran file maksimal 5MB' };
  }
  return { ok: true };
}

export function computeApprovalEffects(
  newStatus: ManualPaymentStatus,
  currentOrderPaymentStatus: string,
): { markPaid: boolean; stampProof: 'approved' | 'rejected' | null } {
  if (newStatus === 'approved') {
    if (currentOrderPaymentStatus === 'paid') return { markPaid: false, stampProof: null };
    return { markPaid: true, stampProof: 'approved' };
  }
  if (newStatus === 'rejected') {
    return { markPaid: false, stampProof: 'rejected' };
  }
  return { markPaid: false, stampProof: null };
}

export function isManualPaymentExpired(
  order: { createdAt: string | Date; paymentStatus: string },
  manualStatus: ManualPaymentStatus,
  now: Date = new Date(),
  ttlHours: number = MANUAL_PAYMENT_TTL_HOURS,
): boolean {
  if (order.paymentStatus !== 'pending') return false;
  if (manualStatus !== 'awaiting_proof' && manualStatus !== 'under_review') return false;
  const created = new Date(order.createdAt).getTime();
  return now.getTime() - created > ttlHours * 60 * 60 * 1000;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:manual-payment`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/manual-payment/services/logic.ts tests/manual-payment-logic.test.ts package.json
git commit -m "feat(manual-payment): add pure decision logic with unit tests"
```

---

## Task 5: Public payment-methods endpoint

**Files:**
- Modify: `src/api/store-setting/controllers/store-setting.ts`
- Create: `src/api/store-setting/routes/payment-methods.ts`

**Interfaces:**
- Consumes: `resolvePaymentMethods` from Task 4; `store-setting` fields from Task 3.
- Produces: `GET /store-setting/payment-methods` returning `{ gateway, manualTransfer, bankAccounts }`.

- [ ] **Step 1: Replace the store-setting controller with a custom handler**

`src/api/store-setting/controllers/store-setting.ts`:

```ts
import { factories } from '@strapi/strapi';
import { resolvePaymentMethods } from '../../manual-payment/services/logic';

export default factories.createCoreController('api::store-setting.store-setting', ({ strapi }) => ({
  async paymentMethods(ctx) {
    const setting = await strapi
      .documents('api::store-setting.store-setting')
      .findFirst({ populate: { bankAccounts: true } });

    ctx.body = { data: resolvePaymentMethods(setting ?? {}) };
  },
}));
```

- [ ] **Step 2: Add the public route**

`src/api/store-setting/routes/payment-methods.ts`:

```ts
export default {
  routes: [
    {
      method: 'GET',
      path: '/store-setting/payment-methods',
      handler: 'store-setting.paymentMethods',
      config: { auth: false },
    },
  ],
};
```

- [ ] **Step 3: Verify manually against a running server**

Run: `npm run develop` (in a separate shell), then:
`curl -s http://localhost:1337/api/store-setting/payment-methods`
Expected: JSON `{ "data": { "gateway": true, "manualTransfer": false, "bankAccounts": [] } }` on a fresh DB (defaults). After enabling manual transfer + adding an active bank account in the admin panel, the bank appears and inactive ones do not.

- [ ] **Step 4: Commit**

```bash
git add src/api/store-setting/controllers/store-setting.ts src/api/store-setting/routes/payment-methods.ts
git commit -m "feat(store-setting): add public payment-methods endpoint"
```

---

## Task 6: Order creation — enforce method + auto-create manual-payment

**Files:**
- Modify: `src/api/order/content-types/order/lifecycles.ts`

**Interfaces:**
- Consumes: `isPaymentMethodEnabled` from Task 4; `api::manual-payment.manual-payment` from Task 2.
- Produces: on manual order create, a linked `manual-payment` (`status = awaiting_proof`, `expectedAmount = totalAmount`).

- [ ] **Step 1: Add the import at the top of `lifecycles.ts`**

Add alongside the existing imports (path points at the manual-payment logic module from Task 4):

```ts
import { isPaymentMethodEnabled } from '../../../manual-payment/services/logic';
```

- [ ] **Step 2: Enforce the enabled method inside the existing `beforeCreate`**

At the very start of the existing `beforeCreate(event)` body (before the voucher logic), insert:

```ts
    const method = (event.params.data.paymentMethod as 'gateway' | 'manual_transfer') || 'gateway';
    const setting = await strapi
      .documents('api::store-setting.store-setting')
      .findFirst();
    if (!isPaymentMethodEnabled(method, setting ?? {})) {
      throw new ApplicationError('Metode pembayaran ini sedang tidak aktif');
    }
```

(`ApplicationError` is already imported in this file.)

- [ ] **Step 3: Merge manual-payment creation into the EXISTING `afterCreate`**

`order/lifecycles.ts` already has an `afterCreate(event)` that sends the confirmation email and contains an early `return` when the order has no user email (around line 142). Do NOT add a second `afterCreate` — insert the manual-payment creation at the **very top** of the existing `afterCreate` body, before the email logic and before that early return, so it runs regardless of email presence:

```ts
  async afterCreate(event: any) {
    const { result } = event;

    // Manual bank transfer: create the linked manual-payment record.
    if (result.paymentMethod === 'manual_transfer') {
      try {
        const existing = await strapi.documents('api::manual-payment.manual-payment').findFirst({
          filters: { order: { documentId: result.documentId } },
        });
        if (!existing) {
          await strapi.documents('api::manual-payment.manual-payment').create({
            data: {
              status: 'awaiting_proof',
              expectedAmount: Number(result.totalAmount) || 0,
              order: result.documentId,
            },
          });
        }
      } catch (err: any) {
        strapi.log.error('Failed to create manual-payment for order:', err);
      }
    }

    // ---- existing email-confirmation logic continues unchanged below ----
```

The rest of the existing `afterCreate` body (the `try { const order = ... }` email block) stays exactly as-is.

- [ ] **Step 4: Verify manually**

Run: `npm run develop`, enable `manualTransferEnabled` in the admin panel, then create an order via the REST API with `"paymentMethod": "manual_transfer"`.
Expected: order created; a `manual-payment` row exists linked to it with `status = awaiting_proof` and `expectedAmount` equal to the order total. Creating a manual order while `manualTransferEnabled = false` returns a 400 with "Metode pembayaran ini sedang tidak aktif".

- [ ] **Step 5: Commit**

```bash
git add src/api/order/content-types/order/lifecycles.ts
git commit -m "feat(order): enforce enabled payment method and auto-create manual-payment"
```

---

## Task 7: Proof upload controller + route (customer)

**Files:**
- Create: `src/api/manual-payment/controllers/manual-payment.ts`
- Create: `src/api/manual-payment/routes/manual-payment.ts`

**Interfaces:**
- Consumes: `validateProofFile` from Task 4; `api::manual-payment.manual-payment` from Task 2.
- Produces: `POST /manual-payments/:orderDocumentId/proofs` — appends a proof, sets status `under_review`.

- [ ] **Step 1: Create the upload controller**

`src/api/manual-payment/controllers/manual-payment.ts`:

```ts
import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { validateProofFile } from '../services/logic';

const { ApplicationError, ForbiddenError, NotFoundError } = errors;

export default factories.createController('api::manual-payment.manual-payment', ({ strapi }) => ({
  async uploadProof(ctx) {
    const user = ctx.state.user;
    if (!user) throw new ForbiddenError('Login diperlukan');

    const { orderDocumentId } = ctx.params;

    const order = await strapi.documents('api::order.order').findOne({
      documentId: orderDocumentId,
      populate: { user: true, manualPayment: true },
    });
    if (!order) throw new NotFoundError('Order tidak ditemukan');
    if (order.user?.documentId !== user.documentId) {
      throw new ForbiddenError('Order ini bukan milik Anda');
    }

    const manualPayment = order.manualPayment;
    if (!manualPayment) throw new ApplicationError('Order ini bukan pembayaran manual');
    if (manualPayment.status === 'approved') {
      throw new ApplicationError('Pembayaran sudah disetujui, tidak bisa unggah lagi');
    }

    const file = (ctx.request.files as any)?.image;
    const check = validateProofFile(file);
    if (!check.ok) throw new ApplicationError(check.error);

    const uploaded = await strapi.plugin('upload').service('upload').upload({
      data: {},
      files: file,
    });
    const imageId = uploaded?.[0]?.id;

    const body = (ctx.request.body ?? {}) as Record<string, any>;
    const existing = await strapi.documents('api::manual-payment.manual-payment').findOne({
      documentId: manualPayment.documentId,
      populate: { proofs: true },
    });
    const proofs = (existing?.proofs ?? []).map((p: any) => ({
      image: p.image?.id ?? p.image,
      senderName: p.senderName,
      senderBank: p.senderBank,
      transferAmount: p.transferAmount,
      transferDate: p.transferDate,
      referenceNote: p.referenceNote,
      destinationBankName: p.destinationBankName,
      destinationAccountNumber: p.destinationAccountNumber,
      proofStatus: p.proofStatus,
      submittedAt: p.submittedAt,
    }));

    proofs.push({
      image: imageId,
      senderName: body.senderName,
      senderBank: body.senderBank,
      transferAmount: body.transferAmount != null ? Number(body.transferAmount) : null,
      transferDate: body.transferDate ?? null,
      referenceNote: body.referenceNote,
      destinationBankName: body.destinationBankName,
      destinationAccountNumber: body.destinationAccountNumber,
      proofStatus: 'pending',
      submittedAt: new Date().toISOString(),
    });

    const updated = await strapi.documents('api::manual-payment.manual-payment').update({
      documentId: manualPayment.documentId,
      data: { status: 'under_review', proofs },
      populate: { proofs: true },
    });

    ctx.body = { data: updated };
  },
}));
```

- [ ] **Step 2: Create the upload route**

`src/api/manual-payment/routes/manual-payment.ts`:

```ts
export default {
  routes: [
    {
      method: 'POST',
      path: '/manual-payments/:orderDocumentId/proofs',
      handler: 'manual-payment.uploadProof',
    },
  ],
};
```

- [ ] **Step 3: Verify manually**

Run: `npm run develop`. As an authenticated customer who owns a manual order, POST a multipart form with an `image` file (and metadata fields) to `/api/manual-payments/<orderDocumentId>/proofs`.
Expected:
- Valid image → 200, manual-payment `status = under_review`, a new proof appended with `proofStatus = pending` and the snapshotted destination bank fields.
- Non-image or >5MB file → 400 with the validation message.
- Another user's order → 403.
- After the payment is approved → 400 "Pembayaran sudah disetujui".

- [ ] **Step 4: Commit**

```bash
git add src/api/manual-payment/controllers/manual-payment.ts src/api/manual-payment/routes/manual-payment.ts
git commit -m "feat(manual-payment): add customer proof upload endpoint"
```

---

## Task 8: Approve/reject lifecycle (afterUpdate)

**Files:**
- Create: `src/api/manual-payment/content-types/manual-payment/lifecycles.ts`

**Interfaces:**
- Consumes: `computeApprovalEffects` from Task 4.
- Produces: side effects on `order` when an admin changes `manual-payment.status` in the panel.

- [ ] **Step 1: Create the lifecycle**

`src/api/manual-payment/content-types/manual-payment/lifecycles.ts`:

```ts
import { computeApprovalEffects, type ManualPaymentStatus } from '../../services/logic';

export default {
  async afterUpdate(event: any) {
    const { result, params } = event;
    // Only react when this update set `status`.
    const newStatus = params?.data?.status as ManualPaymentStatus | undefined;
    if (!newStatus || (newStatus !== 'approved' && newStatus !== 'rejected')) return;

    const strapi = (global as any).strapi;

    const manualPayment = await strapi.documents('api::manual-payment.manual-payment').findOne({
      documentId: result.documentId,
      populate: { order: true, proofs: true },
    });
    if (!manualPayment?.order) return;

    const order = manualPayment.order;
    const effects = computeApprovalEffects(newStatus, order.paymentStatus);
    const now = new Date().toISOString();

    // Stamp the latest proof.
    if (effects.stampProof && Array.isArray(manualPayment.proofs) && manualPayment.proofs.length) {
      const proofs = manualPayment.proofs.map((p: any) => ({
        image: p.image?.id ?? p.image,
        senderName: p.senderName,
        senderBank: p.senderBank,
        transferAmount: p.transferAmount,
        transferDate: p.transferDate,
        referenceNote: p.referenceNote,
        destinationBankName: p.destinationBankName,
        destinationAccountNumber: p.destinationAccountNumber,
        proofStatus: p.proofStatus,
        submittedAt: p.submittedAt,
      }));
      proofs[proofs.length - 1].proofStatus = effects.stampProof;

      await strapi.documents('api::manual-payment.manual-payment').update({
        documentId: manualPayment.documentId,
        data: { proofs, reviewedAt: now },
      });
    } else {
      await strapi.documents('api::manual-payment.manual-payment').update({
        documentId: manualPayment.documentId,
        data: { reviewedAt: now },
      });
    }

    if (effects.markPaid) {
      await strapi.documents('api::order.order').update({
        documentId: order.documentId,
        data: { paymentStatus: 'paid', paidAt: now },
      });
    }
  },
};
```

Note on recursion: the nested `manual-payment` update re-fires `afterUpdate`, but that inner update does not set `status`, so the guard in Step 1 returns early — no loop.

- [ ] **Step 2: Verify manually**

Run: `npm run develop`. Create a manual order, upload a proof (Task 7), then in the admin panel open the `manual-payment` record.
Expected:
- Set `status = approved`, Save → order `paymentStatus = paid`, `paidAt` set, latest proof `proofStatus = approved`, `reviewedAt` set. `orderStatus` unchanged.
- On a fresh order, set `status = rejected` + a `rejectionReason`, Save → order stays `paymentStatus = pending`, latest proof `proofStatus = rejected`. A subsequent customer upload flips status back to `under_review`.
- Re-saving an already-`approved` record does not double-write (order already `paid`).

- [ ] **Step 3: Commit**

```bash
git add src/api/manual-payment/content-types/manual-payment/lifecycles.ts
git commit -m "feat(manual-payment): apply order side effects on approve/reject"
```

---

## Task 9: Expiry cron task

**Files:**
- Create: `src/api/manual-payment/services/expiry.ts`
- Modify: `config/cron-tasks.ts`

**Interfaces:**
- Consumes: `isManualPaymentExpired`, `MANUAL_PAYMENT_TTL_HOURS` from Task 4.
- Produces: `expireStaleManualPayments(strapi): Promise<number>` (returns count cancelled); registered as hourly cron `manualPaymentExpiry`.

**Critical — do NOT restore stock here.** `order/lifecycles.ts` `afterUpdate` already restores inventory whenever an order's `paymentStatus` transitions to `cancelled` (or `failed`/`refunded`). This runner only sets the order status; the existing lifecycle returns the stock. Restoring stock here as well would double-increment inventory.

- [ ] **Step 1: Create the expiry runner**

`src/api/manual-payment/services/expiry.ts`:

```ts
import { isManualPaymentExpired } from './logic';

export async function expireStaleManualPayments(strapi: any): Promise<number> {
  const candidates = await strapi.documents('api::manual-payment.manual-payment').findMany({
    filters: { status: { $in: ['awaiting_proof', 'under_review'] } },
    populate: { order: true },
    limit: 500,
  });

  let cancelled = 0;
  const now = new Date();

  for (const mp of candidates) {
    const order = mp.order;
    if (!order) continue;
    if (!isManualPaymentExpired({ createdAt: order.createdAt, paymentStatus: order.paymentStatus }, mp.status, now)) {
      continue;
    }

    try {
      // Setting paymentStatus=cancelled triggers order.afterUpdate, which restores
      // inventory. Do NOT restore stock here or it double-increments.
      await strapi.documents('api::order.order').update({
        documentId: order.documentId,
        data: { orderStatus: 'cancelled', paymentStatus: 'cancelled' },
      });
      cancelled += 1;
    } catch (err: any) {
      strapi.log.error('Failed to expire manual payment order:', err);
    }
  }

  return cancelled;
}
```

- [ ] **Step 2: Register the cron task**

In `config/cron-tasks.ts`, add a second entry inside the exported object (sibling to `analyticsDailyMaintenance`):

```ts
  manualPaymentExpiry: {
    task: async ({ strapi }) => {
      const { expireStaleManualPayments } = await import(
        '../src/api/manual-payment/services/expiry'
      );
      const count = await expireStaleManualPayments(strapi);
      if (count > 0) {
        strapi.log.info(`Expired ${count} unpaid manual-transfer order(s)`);
      }
    },
    options: {
      rule: '0 0 * * * *',
      tz: 'UTC',
    },
  },
```

- [ ] **Step 3: Verify manually**

Run: `npm run develop`. Create a manual order and its `manual-payment`, then in the DB set that order's `created_at` to more than 24h ago (e.g. `UPDATE orders SET created_at = created_at - interval '2 days' WHERE document_id = '<id>';`). Trigger the runner by waiting for the hourly tick, or add a temporary `strapi.cron.add`/console call.
Expected: the order becomes `orderStatus = cancelled`, `paymentStatus = cancelled`, and its items' inventory is incremented back. A recent (<24h) unpaid order and any paid order are left untouched.

- [ ] **Step 4: Commit**

```bash
git add src/api/manual-payment/services/expiry.ts config/cron-tasks.ts
git commit -m "feat(manual-payment): expire unpaid manual orders after 24h via cron"
```

---

## Self-Review Notes

- **Spec coverage:** separate entity (T2), repeatable proofs (T1/T7), proof metadata + destination snapshot (T1/T7), bank accounts in store-setting (T1/T3), payment-method toggles + server enforcement (T3/T5/T6), approve/reject via lifecycle (T8), coarse `paymentStatus` untouched, owner-scoped upload + file validation (T4/T7), afterCreate auto-create (T6), destination chosen at upload (T7), admin advances `orderStatus` manually (T8 leaves it), 24h expiry with stock return (T9). All covered.
- **Note vs spec:** spec said "cron from scratch" — the cron infrastructure already exists (`config/server.ts` wires `config/cron-tasks.ts`); Task 9 only adds a task entry. No new infra needed.
- **Type consistency:** `logic.ts` exported names (`resolvePaymentMethods`, `isPaymentMethodEnabled`, `validateProofFile`, `computeApprovalEffects`, `isManualPaymentExpired`, `ManualPaymentStatus`) are used verbatim in Tasks 5, 6, 8, 9.
- **Manual verification:** lifecycle/controller tasks are verified against a running dev server because this repo's test harness is pure-unit (`tsx --test`) and has no Strapi integration harness. Pure logic (Task 4) is the TDD core.
