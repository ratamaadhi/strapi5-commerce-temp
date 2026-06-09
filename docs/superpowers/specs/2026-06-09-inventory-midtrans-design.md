# Inventory Decrement + Midtrans Payment Integration — Spec

**Status:** Draft | **Date:** 2026-06-09 | **Author:** AI

---

## 1. Goal

Implementasikan inventory decrement saat order dibuat, inventory restore saat order dibatalkan/direfund, dan integrasi pembayaran dengan **Midtrans Snap API** di Strapi 5 e-commerce backend.

---

## 2. Architecture

### 2.1 Approach

| Aspek | Pilihan |
|-------|---------|
| Decrement strategy | **Simple decrement** — kurangi inventory di `afterCreate`, restore di `afterUpdate` |
| Product reference | **String field** (`productDocumentId`, `variantDocumentId`) di order-item component |
| Midtrans method | **Snap API** — backend generate token, FE render popup |
| Payment webhook | Custom Strapi route handler (public, no auth) |

### 2.2 Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ORDER CREATION                                 │
│                                                                         │
│  FE POST /api/orders                                                    │
│          │                                                              │
│          ▼                                                              │
│  OrderController.create()                                               │
│  1. Validate stock (product.inventory >= item.quantity)                 │
│  2. Generate orderNumber (ORD-{ts}-{random})                            │
│  3. Format Midtrans request body                                        │
│  4. POST https://app.midtrans.com/snap/v1/transactions → snapToken      │
│  5. Create order (db entry with midtransSnapToken)                      │
│          │                                                              │
│          ▼                                                              │
│  afterCreate lifecycle                                                  │
│  1. Loop order.items → decrement product.inventory                      │
│  2. (existing) Send confirmation email                                  │
│          │                                                              │
│          ▼                                                              │
│  Response: { order + midtransSnapToken }                                │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        PAYMENT WEBHOOK                                  │
│                                                                         │
│  Midtrans POST /api/midtrans/webhook                                    │
│          │                                                              │
│          ▼                                                              │
│  MidtransController.webhook()                                           │
│  1. Validate signature hash (SHA512: orderId+statusCode+grossAmount+key)│
│  2. Lookup order by orderId (mapped to orderNumber)                     │
│  3. Update order:                                                       │
│     - paymentStatus → paid/failed (map from transaction_status)         │
│     - midtransTransactionId                                             │
│     - midtransTransactionStatus → settlement/pending/capture/deny/...   │
│     - midtransPaymentType → credit_card/gopay/bank_transfer/...         │
│     - paidAt → now (if settlement)                                      │
│          │                                                              │
│          ▼                                                              │
│  Response: 200 OK (Midtrans expects this)                               │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        ORDER CANCELLATION                               │
│                                                                         │
│  Admin/User PUT /api/orders/:id { orderStatus: "cancelled" }            │
│          │                                                              │
│          ▼                                                              │
│  afterUpdate lifecycle                                                  │
│  1. Check if orderStatus changed to "cancelled" or "refunded"           │
│  2. Loop order.items → restore product.inventory                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Model Changes

### 3.1 Order Schema

**File:** `src/api/order/content-types/order/schema.json`

Tambahkan 5 field baru setelah field `currency`:

```json
{
  "midtransTransactionId": {
    "type": "string"
  },
  "midtransTransactionStatus": {
    "type": "string"
  },
  "midtransPaymentType": {
    "type": "string"
  },
  "midtransSnapToken": {
    "type": "text"
  },
  "paidAt": {
    "type": "datetime"
  }
}
```

### 3.2 order-item Component

**File:** `src/components/product/order-item.json`

Tambahkan 2 field baru setelah field `variantInfo`:

```json
{
  "productDocumentId": {
    "type": "string",
    "required": true
  },
  "variantSku": {
    "type": "string"
  }
}
```

### 3.3 Product Schema

**No changes.** Field `inventory` (biginteger) sudah ada.

---

## 4. New Files

| File | Purpose |
|------|---------|
| `src/api/midtrans/routes/midtrans.ts` | Route untuk webhook handler |
| `src/api/midtrans/controllers/midtrans.ts` | Webhook handler + signature validation |
| `src/api/midtrans/services/midtrans.ts` | Midtrans API calls (Snap token, signature) |

---

## 5. Modified Files

| File | Change |
|------|--------|
| `src/api/order/content-types/order/schema.json` | Tambah 5 Midtrans fields |
| `src/components/product/order-item.json` | Tambah `productDocumentId`, `variantSku` |
| `src/api/order/controllers/order.ts` | `create()`: tambah stock validation + Midtrans Snap call |
| `src/api/order/content-types/order/lifecycles.ts` | `afterCreate`: decrement inventory; `afterUpdate`: restore inventory |
| `config/plugins.ts` | Tambah `midtrans` plugin config |
| `.env.example` | Tambah Midtrans env vars |

---

## 6. Lifecycle Hooks Detail

### 6.1 afterCreate — Decrement Inventory

```
for each item in order.items:
  product = await strapi.entityService.findOne('api::product.product', item.productDocumentId, {fields: ['inventory']})
  newInventory = product.inventory - item.quantity
  await strapi.entityService.update('api::product.product', item.productDocumentId, {data: {inventory: newInventory}})

  if item.variantSku:
    product = await strapi.entityService.findOne('api::product.product', item.productDocumentId, {populate: ['variants']})
    variant = product.variants.find(v => v.sku === item.variantSku)
    variant.inventory -= item.quantity
    await strapi.entityService.update('api::product.product', item.productDocumentId, {data: {variants: product.variants}})
```

**Note on variants:** Karena product variant adalah component (repeatable), Strapi tidak support partial update per variant. Harus fetch seluruh Product, modify array `variants`, lalu `update` semua.

### 6.2 afterUpdate — Restore Inventory

Dipicu saat `order.orderStatus` berubah ke `"cancelled"` atau `"refunded"`, atau `order.paymentStatus` berubah ke `"refunded"`.

```
if (!wasAlreadyCancelled && now is cancelled/refunded):
  for each item in order.items:
    product = await strapi.entityService.findOne('api::product.product', item.productDocumentId, {fields: ['inventory']})
    await strapi.entityService.update('api::product.product', item.productDocumentId, {data: {inventory: product.inventory + item.quantity}})

    if item.variantSku:
      product = await strapi.entityService.findOne('api::product.product', item.productDocumentId, {populate: ['variants']})
      variant = product.variants.find(v => v.sku === item.variantSku)
      variant.inventory += item.quantity
      await strapi.entityService.update('api::product.product', item.productDocumentId, {data: {variants: product.variants}})
```

**Prevent double-restore:** Cek `previousState` dan `newState` — hanya restore jika transition-nya masuk akal (contoh: `pending → cancelled`, bukan `cancelled → cancelled`).

---

## 7. Midtrans Integration Detail

### 7.1 Snap Token Request

**Endpoint:** `POST {MIDTRANS_BASE_URL}/snap/v1/transactions`

**Auth:** Basic Auth (`server_key:` base64 encoded)

**Request body:**
```json
{
  "transaction_details": {
    "order_id": "ORD-1717918800000-A3F2",
    "gross_amount": 150000
  },
  "customer_details": {
    "first_name": "Budi",
    "email": "budi@example.com",
    "phone": "08123456789"
  },
  "item_details": [
    {
      "id": "PROD-DOC-ID-001",
      "price": 150000,
      "quantity": 1,
      "name": "Jaket Kulit Premium"
    }
  ],
  "callbacks": {
    "finish": "https://mysite.com/orders/ORD-xxx/thank-you"
  }
}
```

### 7.2 Webhook Notification

**Endpoint di Strapi:** `POST /api/midtrans/webhook`

**Payload dari Midtrans:**
```json
{
  "transaction_time": "2024-01-01 12:00:00",
  "transaction_status": "settlement",
  "transaction_id": "abc123-def456",
  "status_message": "midtrans payment notification",
  "status_code": "200",
  "signature_key": "hashed_value",
  "payment_type": "credit_card",
  "order_id": "ORD-1717918800000-A3F2",
  "merchant_id": "G123456789",
  "gross_amount": "150000.00",
  "fraud_status": "accept",
  "currency": "IDR"
}
```

**Signature validation:**
```
expected = SHA512(order_id + status_code + gross_amount + server_key)
compare with signature_key from payload
```

### 7.3 Status Mapping

| Midtrans `transaction_status` | Order `paymentStatus` |
|-------------------------------|-----------------------|
| `settlement` / `capture` | `paid` |
| `pending` | `pending` |
| `deny` / `expire` / `cancel` | `failed` |
| `refund` / `partial_refund` | `refunded` |

---

## 8. Config & Environment

### 8.1 Middleware / Plugin Config

**New section in `config/plugins.ts`** atau bisa juga sebagai custom config di `src/index.ts`:

Tidak perlu plugin Strapi terpisah. Midtrans service adalah custom service aksesible via `strapi.service('api::midtrans.midtrans')`.

### 8.2 Environment Variables

```env
# Midtrans
MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxxxxxxxx
MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxxxxxxxxxxxx
MIDTRANS_IS_PRODUCTION=false
MIDTRANS_SNAP_URL=https://app.sandbox.midtrans.com/snap/v1/transactions
```

---

## 9. Error Handling

| Scenario | Handling |
|----------|----------|
| Stock tidak cukup | Return `400 Bad Request` — jangan buat order |
| Midtrans API error | Return `502 Bad Gateway` — jangan buat order |
| afterCreate decrement gagal | Order sudah terlanjur dibuat (no rollback). Log critical error. Admin harus manual resolve. |
| afterUpdate restore gagal | Log critical error. Manual resolve. |
| Webhook signature invalid | Return `403 Forbidden` |
| Webhook order not found | Return `404 Not Found` |
| Double webhook notification | Idempotency check — bandingkan `midtransTransactionStatus` sebelum update |

**N.B.:** Ideal untuk production: decrement sebaiknya dalam transaction supaya bisa rollback jika gagal. Strapi 5 support `strapi.db.transaction()` tapi entity service / document service di dalam transaction masih perlu verifikasi.

---

## 10. API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/orders` | User | Create order + return Snap token |
| `PUT` | `/api/orders/:id` | User (owner) | Update order (cancellation) |
| `POST` | `/api/midtrans/webhook` | None | Midtrans payment notification |

---

## 11. User Manual Setup (Yang Dikerjakan User)

Setup ini **TIDAK bisa diotomatisasi** oleh kode dan harus dilakukan user secara manual:

| # | Task | Detail |
|---|------|--------|
| 1 | **Register Midtrans account** | Daftar di [midtrans.com](https://midtrans.com) → pilih **Sandbox** untuk testing |
| 2 | **Dapatkan API Keys** | Dashboard → Settings → Access Keys → Copy **Server Key** & **Client Key** |
| 3 | **Set environment variables** | Tambahkan ke `.env` file (lihat §8.2) |
| 4 | **Configure webhook URL** | Dashboard Midtrans → Settings → Payment Notification → URL: `https://domain.com/api/midtrans/webhook` |
| 5 | **Restart Strapi** | `npm run develop` (dev) atau `npm run build && npm run start` (prod) |
| 6 | **Rebuild Admin** | Schema berubah → Strapi admin panel perlu re-login / refresh |

---

## 12. Testing Strategy

| Test | Type | Scope |
|------|------|-------|
| Stock validation returns 400 on insufficient stock | Unit | OrderController.create |
| Order creation decrements inventory | Integration | afterCreate lifecycle |
| Order cancellation restores inventory | Integration | afterUpdate lifecycle |
| Double cancel does not double-restore | Integration | afterUpdate lifecycle |
| Webhook signature validation rejects bad signature | Unit | MidtransController.webhook |
| Webhook maps settlement → paid correctly | Integration | MidtransController.webhook |
| Midtrans Snap token generation with valid payload | Integration | MidtransService (mock HTTP call) |
| Edge case: zero stock at creation time | Unit | OrderController.create |
