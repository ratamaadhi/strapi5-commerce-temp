# Inventory Decrement + Midtrans Payment Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inventory decrement on order creation, restore on cancellation, and Midtrans Snap payment integration to Strapi 5 e-commerce backend.

**Architecture:** OrderController.create validates stock then calls Midtrans Snap API before persisting the order. afterCreate lifecycle decrements product/variant inventory. afterUpdate detects cancelled/refunded status and restores inventory. A dedicated Midtrans route/controller/service handles payment webhooks with signature validation.

**Tech Stack:** Strapi 5 TypeScript, Node.js native fetch, Midtrans Snap API

---

### Task 1: Add `productDocumentId` + `variantSku` to order-item component

**Files:**
- Modify: `src/components/product/order-item.json`

- [ ] **Step 1: Add fields to component schema**

Read the current schema and add `productDocumentId` (required) and `variantSku` after `variantInfo`:

```json
{
  "collectionName": "components_product_order_items",
  "info": {
    "displayName": "orderItem",
    "icon": "bulletList"
  },
  "options": {},
  "attributes": {
    "productName": {
      "type": "string",
      "required": true
    },
    "productSku": {
      "type": "text"
    },
    "variantInfo": {
      "type": "text"
    },
    "productDocumentId": {
      "type": "string",
      "required": true
    },
    "variantSku": {
      "type": "string"
    },
    "quantity": {
      "type": "biginteger",
      "required": true,
      "min": "1"
    },
    "unitPrice": {
      "type": "decimal",
      "required": true
    },
    "totalPrice": {
      "type": "decimal",
      "required": true
    },
    "imageUrl": {
      "type": "string"
    }
  },
  "config": {}
}
```

### Task 2: Add Midtrans fields to Order schema

**Files:**
- Modify: `src/api/order/content-types/order/schema.json`

- [ ] **Step 1: Add 5 Midtrans fields**

Add after the `currency` field (line 63):

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

Full context snippet (insert between `currency` and `notes`):
```json
    "currency": {
      "type": "string",
      "default": "IDR"
    },
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
    },
    "notes": {
      "type": "text"
    },
```

### Task 3: Add Midtrans environment variables

**Files:**
- Modify: `.env.example`
- Modify: `.env` (if exists)

- [ ] **Step 1: Add to .env.example**

Append after the SMTP section:

```env
# Midtrans Payment Gateway
MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxxxxxxxx
MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxxxxxxxxxxxx
MIDTRANS_IS_PRODUCTION=false
MIDTRANS_SNAP_URL=https://app.sandbox.midtrans.com/snap/v1/transactions
```

### Task 4: Create Midtrans service

**Files:**
- Create: `src/api/midtrans/services/midtrans.ts`

- [ ] **Step 1: Create service file with Snap token + signature logic**

```ts
export default ({ strapi }: { strapi: any }) => ({
  getServerKey(): string {
    return process.env.MIDTRANS_SERVER_KEY ?? '';
  },

  getSnapUrl(): string {
    return process.env.MIDTRANS_SNAP_URL ?? 'https://app.sandbox.midtrans.com/snap/v1/transactions';
  },

  getAuthHeader(): string {
    const serverKey = this.getServerKey();
    return 'Basic ' + Buffer.from(serverKey + ':').toString('base64');
  },

  async generateSnapToken(params: {
    orderId: string;
    grossAmount: number;
    customerDetails: {
      firstName: string;
      email: string;
      phone: string;
    };
    itemDetails: Array<{
      id: string;
      price: number;
      quantity: number;
      name: string;
    }>;
  }): Promise<{ token: string; redirectUrl: string }> {
    const body = {
      transaction_details: {
        order_id: params.orderId,
        gross_amount: params.grossAmount,
      },
      customer_details: {
        first_name: params.customerDetails.firstName,
        email: params.customerDetails.email,
        phone: params.customerDetails.phone,
      },
      item_details: params.itemDetails,
    };

    const response = await fetch(this.getSnapUrl(), {
      method: 'POST',
      headers: {
        'Authorization': this.getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Midtrans Snap API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as any;
    return { token: data.token, redirectUrl: data.redirect_url };
  },

  validateSignature(payload: {
    orderId: string;
    statusCode: string;
    grossAmount: string;
    signatureKey: string;
  }): boolean {
    const serverKey = this.getServerKey();
    const input = payload.orderId + payload.statusCode + payload.grossAmount + serverKey;
    const expected = require('crypto').createHash('sha512').update(input).digest('hex');
    return expected === payload.signatureKey;
  },

  mapPaymentStatus(midtransStatus: string): string {
    const mapping: Record<string, string> = {
      settlement: 'paid',
      capture: 'paid',
      pending: 'pending',
      deny: 'failed',
      expire: 'failed',
      cancel: 'failed',
      refund: 'refunded',
      partial_refund: 'refunded',
    };
    return mapping[midtransStatus] ?? 'pending';
  },
});
```

### Task 5: Create Midtrans controller + routes (webhook)

**Files:**
- Create: `src/api/midtrans/controllers/midtrans.ts`
- Create: `src/api/midtrans/routes/midtrans.ts`

- [ ] **Step 1: Create routes file**

```ts
export default {
  routes: [
    {
      method: 'POST',
      path: '/midtrans/webhook',
      handler: 'midtrans.webhook',
      config: {
        auth: false,
      },
    },
  ],
};
```

- [ ] **Step 2: Create controller file**

```ts
export default {
  async webhook(ctx: any) {
    const payload = ctx.request.body;

    strapi.log.info('Midtrans webhook received:', JSON.stringify(payload));

    const service = strapi.service('api::midtrans.midtrans');

    const isValid = service.validateSignature({
      orderId: payload.order_id,
      statusCode: payload.status_code,
      grossAmount: payload.gross_amount,
      signatureKey: payload.signature_key,
    });

    if (!isValid) {
      strapi.log.warn('Midtrans webhook: invalid signature');
      return ctx.forbidden('Invalid signature');
    }

    const orders = await strapi.documents('api::order.order').findMany({
      filters: { orderNumber: { $eq: payload.order_id } },
    }) as any;

    if (!orders || orders.length === 0) {
      strapi.log.warn(`Midtrans webhook: order not found: ${payload.order_id}`);
      return ctx.notFound('Order not found');
    }

    const order = orders[0];
    const newPaymentStatus = service.mapPaymentStatus(payload.transaction_status);

    const updateData: any = {
      midtransTransactionId: payload.transaction_id,
      midtransTransactionStatus: payload.transaction_status,
      midtransPaymentType: payload.payment_type,
      paymentStatus: newPaymentStatus,
    };

    if (payload.transaction_status === 'settlement' || payload.transaction_status === 'capture') {
      updateData.paidAt = new Date().toISOString();
    }

    await strapi.documents('api::order.order').update({
      documentId: order.documentId,
      data: updateData,
    });

    strapi.log.info(`Order ${payload.order_id} payment updated: ${newPaymentStatus}`);

    ctx.body = { status: 'ok' };
  },
};
```

### Task 6: Modify Order controller — stock validation + Midtrans Snap call

**Files:**
- Modify: `src/api/order/controllers/order.ts`

- [ ] **Step 1: Replace the `create` method**

Remove the existing `create` method (lines 58-76) and replace with:

```ts
  async create(ctx) {
    await this.validateQuery(ctx);

    const sanitizedQueryParams = await this.sanitizeQuery(ctx);
    const requestData = ctx.request.body.data ?? ctx.request.body;
    const items = requestData.items ?? [];
    const shippingAddress = requestData.shippingAddress ?? null;

    for (const item of items) {
      if (!item.productDocumentId) {
        return ctx.badRequest('productDocumentId is required for each order item');
      }

      const product = await strapi.documents('api::product.product').findOne({
        documentId: item.productDocumentId,
        populate: ['variants'],
      }) as any;

      if (!product) {
        return ctx.badRequest(`Product not found: ${item.productDocumentId}`);
      }

      if (item.variantSku) {
        if (!product.variants || product.variants.length === 0) {
          return ctx.badRequest(`Product ${product.name} has no variants`);
        }
        const variant = product.variants.find((v: any) => v.sku === item.variantSku);
        if (!variant) {
          return ctx.badRequest(`Variant not found: SKU ${item.variantSku}`);
        }
        if (variant.inventory < item.quantity) {
          return ctx.badRequest(
            `Insufficient stock for ${product.name} (${variant.name}): requested ${item.quantity}, available ${variant.inventory}`
          );
        }
      } else {
        if (product.inventory < item.quantity) {
          return ctx.badRequest(
            `Insufficient stock for ${product.name}: requested ${item.quantity}, available ${product.inventory}`
          );
        }
      }
    }

    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    const orderNumber = `ORD-${ts}-${rand}`;

    const userEntity = ctx.state.user
      ? await strapi.documents('plugin::users-permissions.user').findOne({
          documentId: ctx.state.user.documentId,
        }) as any
      : null;

    let snapToken: string | null = null;
    try {
      const midtransService = strapi.service('api::midtrans.midtrans');

      const customerFirstName = shippingAddress?.firstName
        ?? userEntity?.firstname
        ?? userEntity?.username
        ?? 'Customer';

      const customerEmail = shippingAddress?.email ?? userEntity?.email ?? '';
      const customerPhone = shippingAddress?.phone ?? userEntity?.phone ?? '';

      const result = await midtransService.generateSnapToken({
        orderId: orderNumber,
        grossAmount: Number(requestData.totalAmount ?? 0),
        customerDetails: {
          firstName: customerFirstName,
          email: customerEmail,
          phone: customerPhone,
        },
        itemDetails: items.map((item: any) => ({
          id: item.productDocumentId + (item.variantSku ? `-${item.variantSku}` : ''),
          price: Number(item.unitPrice ?? 0),
          quantity: Number(item.quantity ?? 0),
          name: item.productName ?? 'Product',
        })),
      });

      snapToken = result.token;
    } catch (err: any) {
      strapi.log.error('Midtrans Snap token generation failed:', err);
      return ctx.internalServerError('Payment gateway error: ' + (err.message ?? 'Unknown'));
    }

    const entity = await strapi
      .service('api::order.order')
      .create({
        ...sanitizedQueryParams,
        data: {
          orderNumber,
          ...requestData,
          midtransSnapToken: snapToken,
          ...(ctx.state.user ? { user: ctx.state.user.documentId } : {}),
        },
      });

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);

    return this.transformResponse(sanitizedEntity);
  },
```

### Task 7: Modify Order lifecycle — decrement inventory in afterCreate

**Files:**
- Modify: `src/api/order/content-types/order/lifecycles.ts`

- [ ] **Step 1: Add inventory decrement after the existing email logic**

Insert after line 3 (`const { result } = event;`) and before the `try` block at line 5. Place the decrement in its own try/catch so email still sends even if decrement fails:

Replace the entire `afterCreate` method content (lines 2-89) with:

```ts
export default {
  async afterCreate(event: any) {
    const { result } = event;

    try {
      const order = await strapi.documents('api::order.order').findOne({
        documentId: result.documentId,
        populate: ['user', 'items'],
      }) as any;

      if (order.items && order.items.length > 0) {
        for (const item of order.items) {
          if (!item.productDocumentId) {
            strapi.log.warn('Order item missing productDocumentId, skipping decrement');
            continue;
          }

          const product = await strapi.documents('api::product.product').findOne({
            documentId: item.productDocumentId,
            populate: ['variants'],
          }) as any;

          if (!product) {
            strapi.log.warn(`Product not found for decrement: ${item.productDocumentId}`);
            continue;
          }

          if (item.variantSku && product.variants && product.variants.length > 0) {
            const variantIndex = product.variants.findIndex(
              (v: any) => v.sku === item.variantSku
            );
            if (variantIndex >= 0) {
              const variant = product.variants[variantIndex];
              const qty = Number(item.quantity) || 0;
              variant.inventory = Math.max(0, Number(variant.inventory) - qty);

              await strapi.documents('api::product.product').update({
                documentId: product.documentId,
                data: { variants: product.variants },
              });

              strapi.log.info(
                `Decremented variant ${variant.sku} inventory by ${qty}`
              );
            }
          } else {
            const qty = Number(item.quantity) || 0;
            const newInventory = Math.max(0, Number(product.inventory) - qty);

            await strapi.documents('api::product.product').update({
              documentId: product.documentId,
              data: { inventory: newInventory },
            });

            strapi.log.info(
              `Decremented product ${product.documentId} inventory by ${qty}`
            );
          }
        }
      }
    } catch (err: any) {
      strapi.log.error('Failed to decrement inventory on order create:', err);
    }

    try {
      const order = await strapi.documents('api::order.order').findOne({
        documentId: result.documentId,
        populate: ['user', 'items'],
      }) as any;

      const customerEmail = order.user?.email ?? null;
      if (!customerEmail) {
        strapi.log.warn('Order confirmation skipped: order has no associated user with email');
        return;
      }

      const template = {
        subject: `Order #${order.orderNumber} - Confirmed`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">Order Confirmed</h1>
            <p>Thank you for your order! Your order <strong>#<%= orderNumber %></strong> has been received.</p>

            <h2 style="color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Order Details</h2>
            <p>Status: <strong><%= orderStatus %></strong></p>
            <p>Payment: <strong><%= paymentStatus %></strong></p>

            <h2 style="color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Items</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="background: #f5f5f5;">
                <th style="text-align: left; padding: 8px;">Product</th>
                <th style="text-align: right; padding: 8px;">Qty</th>
                <th style="text-align: right; padding: 8px;">Price</th>
                <th style="text-align: right; padding: 8px;">Total</th>
              </tr>
              <% items.forEach(item => { %>
                <tr>
                  <td style="padding: 8px;"><%= item.productName %><% if (item.variantInfo) { %> <small>(<%= item.variantInfo %>)</small><% } %></td>
                  <td style="text-align: right; padding: 8px;"><%= item.quantity %></td>
                  <td style="text-align: right; padding: 8px;"><%= currency %> <%= Number(item.unitPrice).toLocaleString() %></td>
                  <td style="text-align: right; padding: 8px;"><%= currency %> <%= Number(item.totalPrice).toLocaleString() %></td>
                </tr>
              <% }) %>
            </table>

            <p style="margin-top: 16px; font-weight: bold;">Subtotal: <%= currency %> <%= Number(subtotal).toLocaleString() %></p>
            <p>Tax: <%= currency %> <%= Number(tax).toLocaleString() %></p>
            <p>Shipping: <%= currency %> <%= Number(shippingCost).toLocaleString() %></p>
            <% if (discount > 0) { %><p>Discount: -<%= currency %> <%= Number(discount).toLocaleString() %></p><% } %>
            <p style="font-size: 18px; font-weight: bold; color: #d32f2f;">Total: <%= currency %> <%= Number(totalAmount).toLocaleString() %></p>

            <% if (shippingAddress) { %>
              <h2 style="color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Shipping Address</h2>
              <p><%= shippingAddress.firstName %> <%= shippingAddress.lastName %></p>
              <p><%= shippingAddress.addressLine1 %></p>
              <% if (shippingAddress.addressLine2) { %><p><%= shippingAddress.addressLine2 %></p><% } %>
              <p><%= shippingAddress.city %>, <%= shippingAddress.state %> <%= shippingAddress.postalCode %></p>
              <p><%= shippingAddress.country %></p>
            <% } %>

            <hr style="margin-top: 24px; border: none; border-top: 1px solid #eee;" />
            <p style="font-size: 12px; color: #999;">This is an automated message. Please do not reply.</p>
          </div>
        `,
      };

      await strapi.plugins['email'].services.email.sendTemplatedEmail(
        { to: customerEmail },
        template,
        {
          orderNumber: order.orderNumber,
          orderStatus: order.orderStatus,
          paymentStatus: order.paymentStatus,
          items: order.items || [],
          subtotal: order.subtotal,
          tax: order.tax,
          shippingCost: order.shippingCost,
          discount: order.discount,
          totalAmount: order.totalAmount,
          currency: order.currency,
          shippingAddress: order.shippingAddress,
        }
      );

      strapi.log.info(`Order confirmation sent to ${customerEmail}`);
    } catch (err: any) {
      strapi.log.error('Failed to send order confirmation:', err);
    }
  },
```

### Task 8: Modify Order lifecycle — restore inventory in afterUpdate

**Files:**
- Modify: `src/api/order/content-types/order/lifecycles.ts`

- [ ] **Step 1: Add afterUpdate hook**

Add after the closing `},` of the `afterCreate` block (before the final `};`):

```ts
  async afterUpdate(event: any) {
    const { result } = event;

    try {
      const statusesToRestore = ['cancelled', 'refunded'];
      const newOrderStatus = result.orderStatus;
      const newPaymentStatus = result.paymentStatus;

      const shouldRestore =
        statusesToRestore.includes(newOrderStatus) ||
        statusesToRestore.includes(newPaymentStatus);

      if (!shouldRestore) {
        return;
      }

      const order = await strapi.documents('api::order.order').findOne({
        documentId: result.documentId,
        populate: ['items'],
      }) as any;

      if (!order.items || order.items.length === 0) {
        return;
      }

      for (const item of order.items) {
        if (!item.productDocumentId) {
          strapi.log.warn('Order item missing productDocumentId, skipping restore');
          continue;
        }

        const product = await strapi.documents('api::product.product').findOne({
          documentId: item.productDocumentId,
          populate: ['variants'],
        }) as any;

        if (!product) {
          strapi.log.warn(`Product not found for restore: ${item.productDocumentId}`);
          continue;
        }

        if (item.variantSku && product.variants && product.variants.length > 0) {
          const variantIndex = product.variants.findIndex(
            (v: any) => v.sku === item.variantSku
          );
          if (variantIndex >= 0) {
            const variant = product.variants[variantIndex];
            const qty = Number(item.quantity) || 0;
            variant.inventory = Number(variant.inventory) + qty;

            await strapi.documents('api::product.product').update({
              documentId: product.documentId,
              data: { variants: product.variants },
            });

            strapi.log.info(
              `Restored variant ${variant.sku} inventory by ${qty}`
            );
          }
        } else {
          const qty = Number(item.quantity) || 0;
          const newInventory = Number(product.inventory) + qty;

          await strapi.documents('api::product.product').update({
            documentId: product.documentId,
            data: { inventory: newInventory },
          });

          strapi.log.info(
            `Restored product ${product.documentId} inventory by ${qty}`
          );
        }
      }
    } catch (err: any) {
      strapi.log.error('Failed to restore inventory on order update:', err);
    }
  },
```

### Task 9: Rebuild Strapi types and verify

**Files:**
- No changes (types auto-generated)

- [ ] **Step 1: Restart Strapi dev server to pick up schema changes**

Run: `npm run develop`

Expected: Strapi starts without errors. Auto-generated types in `types/generated/` should include new fields.

- [ ] **Step 2: Verify new fields in Admin Panel**

Open Admin Panel → Content-Type Builder → Order → Verify these new fields exist:
- midtransTransactionId
- midtransTransactionStatus
- midtransPaymentType
- midtransSnapToken
- paidAt

Open Admin Panel → Content-Type Builder → orderItem component → Verify:
- productDocumentId (required)
- variantSku

- [ ] **Step 3: Test stock validation with insufficient stock**

Send POST to `/api/orders`:

```bash
curl -X POST http://localhost:1337/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt_token>" \
  -d '{
    "items": [{
      "productDocumentId": "a1b2c3d4",
      "productName": "Test Product",
      "quantity": 999,
      "unitPrice": 10000,
      "totalPrice": 9990000
    }],
    "shippingAddress": {
      "firstName": "Test",
      "addressLine1": "Jl. Test",
      "city": "Jakarta",
      "state": "DKI Jakarta",
      "postalCode": "12345",
      "country": "Indonesia",
      "phone": "08123456789",
      "email": "test@example.com"
    },
    "totalAmount": 9990000
  }'
```

Expected: `400 Bad Request` with message "Insufficient stock for Test Product"

- [ ] **Step 4: Commit all changes**

```bash
git add src/components/product/order-item.json
git add src/api/order/content-types/order/schema.json
git add src/api/order/content-types/order/lifecycles.ts
git add src/api/order/controllers/order.ts
git add src/api/midtrans/
git add .env.example
git commit -m "feat: add inventory decrement, restore, and midtrans payment integration"
```

---

## User Manual Setup (After Implementation)

Setelah semua task di atas selesai diimplementasi, user perlu melakukan setup manual berikut:

| # | Task | Detail |
|---|------|--------|
| 1 | **Register Midtrans Sandbox account** | [dashboard.sandbox.midtrans.com](https://dashboard.sandbox.midtrans.com) |
| 2 | **Dapatkan Server Key & Client Key** | Dashboard → Settings → Access Keys |
| 3 | **Update .env dengan key asli** | Ganti placeholder `SB-Mid-server-xxxxx` & `SB-Mid-client-xxxxx` |
| 4 | **Deploy ke server / set public URL** | Webhook harus bisa diakses Midtrans (ngrok/localhost tidak bisa) |
| 5 | **Config Payment Notification URL** | Midtrans Dashboard → Settings → `https://yourdomain.com/api/midtrans/webhook` |
| 6 | **Restart Strapi** | `npm run build && npm run start` (production) |
