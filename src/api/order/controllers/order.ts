/**
 * order controller
 */

import { factories } from '@strapi/strapi';

async function rollbackDecrements(
  strapi: any,
  items: Array<{
    productId: number;
    variantSku: string | null;
    quantity: number;
    mode: 'product' | 'variant';
  }>
) {
  for (const item of items) {
    try {
      if (item.mode === 'variant' && item.variantSku) {
        await strapi.db.connection.raw(
          `UPDATE components_product_product_variants
           SET inventory = inventory + :qty
           WHERE entity_id = :pid AND sku = :sku`,
          { pid: item.productId, sku: item.variantSku, qty: item.quantity }
        );
      } else {
        await strapi.db.connection.raw(
          `UPDATE products
           SET inventory = inventory + :qty
           WHERE id = :id`,
          { id: item.productId, qty: item.quantity }
        );
      }
    } catch (err: any) {
      strapi.log.error('Rollback decrement failed:', err);
    }
  }
}

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async find(ctx) {
    await this.validateQuery(ctx);

    const sanitizedQueryParams = await this.sanitizeQuery(ctx);

    if (ctx.state.user) {
      sanitizedQueryParams.filters = Object.assign(
        {} as any,
        sanitizedQueryParams.filters || {},
        { user: { documentId: { $eq: ctx.state.user.documentId } } },
      );
    }

    const { results, pagination } = await strapi
      .service('api::order.order')
      .find(sanitizedQueryParams);

    const sanitizedResults = await this.sanitizeOutput(results, ctx);

    return this.transformResponse(sanitizedResults, { pagination });
  },

  async findOne(ctx) {
    const { id } = ctx.params;

    await this.validateQuery(ctx);

    const sanitizedQueryParams = await this.sanitizeQuery(ctx);

    if (ctx.state.user) {
      sanitizedQueryParams.filters = Object.assign(
        {} as any,
        sanitizedQueryParams.filters || {},
        { user: { documentId: { $eq: ctx.state.user.documentId } } },
      );
    }

    const entity = await strapi
      .service('api::order.order')
      .findOne(id, sanitizedQueryParams);

    if (!entity) {
      return ctx.notFound();
    }

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);

    return this.transformResponse(sanitizedEntity);
  },

  async create(ctx) {
    await this.validateQuery(ctx);

    const sanitizedQueryParams = await this.sanitizeQuery(ctx);
    const requestData = ctx.request.body.data ?? ctx.request.body;
    const items = requestData.items ?? [];
    const shippingAddress = requestData.shippingAddress ?? null;

    const decrementedItems: Array<{
      productId: number;
      variantSku: string | null;
      quantity: number;
      mode: 'product' | 'variant';
    }> = [];

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

      const qty = Number(item.quantity) || 0;
      if (qty <= 0) {
        return ctx.badRequest(`Quantity must be positive for ${item.productName ?? 'product'}`);
      }

      if (item.variantSku) {
        if (!product.variants || product.variants.length === 0) {
          return ctx.badRequest(`Product ${product.name} has no variants`);
        }
        const variant = product.variants.find((v: any) => v.sku === item.variantSku);
        if (!variant) {
          return ctx.badRequest(`Variant not found: SKU ${item.variantSku}`);
        }

        const [result] = await strapi.db.connection.raw(
          `UPDATE components_product_product_variants
           SET inventory = inventory - :qty
           WHERE entity_id = :pid AND sku = :sku AND inventory >= :qty
           RETURNING id`,
          { pid: Number(product.id), sku: item.variantSku, qty }
        );

        if (!result?.rows || result.rows.length === 0) {
          await rollbackDecrements(strapi, decrementedItems);
          return ctx.badRequest(
            `Insufficient stock for ${product.name} (${variant.name}): requested ${qty}, insufficient stock`
          );
        }

        decrementedItems.push({
          productId: Number(product.id),
          variantSku: item.variantSku,
          quantity: qty,
          mode: 'variant',
        });
      } else {
        if (product.inventory < qty) {
          return ctx.badRequest(
            `Insufficient stock for ${product.name}: requested ${qty}, available ${product.inventory}`
          );
        }

        const [result] = await strapi.db.connection.raw(
          `UPDATE products
           SET inventory = inventory - :qty
           WHERE id = :id AND inventory >= :qty
           RETURNING id`,
          { id: Number(product.id), qty }
        );

        if (!result?.rows || result.rows.length === 0) {
          await rollbackDecrements(strapi, decrementedItems);
          return ctx.badRequest(
            `Insufficient stock for ${product.name}: requested ${qty}, insufficient stock`
          );
        }

        decrementedItems.push({
          productId: Number(product.id),
          variantSku: null,
          quantity: qty,
          mode: 'product',
        });
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

      const productItems = items.map((item: any) => ({
        id: item.productDocumentId + (item.variantSku ? `-${item.variantSku}` : ''),
        price: Number(item.unitPrice ?? 0),
        quantity: Number(item.quantity ?? 0),
        name: item.productName ?? 'Product',
      }));

      const midtransItems = [...productItems];

      if (Number(requestData.shippingCost ?? 0) > 0) {
        midtransItems.push({
          id: 'SHIPPING',
          price: Number(requestData.shippingCost ?? 0),
          quantity: 1,
          name: 'Shipping Cost',
        });
      }

      if (Number(requestData.tax ?? 0) > 0) {
        midtransItems.push({
          id: 'TAX',
          price: Number(requestData.tax ?? 0),
          quantity: 1,
          name: 'Tax',
        });
      }

      if (Number(requestData.discount ?? 0) > 0) {
        midtransItems.push({
          id: 'DISCOUNT',
          price: -Number(requestData.discount ?? 0),
          quantity: 1,
          name: 'Discount',
        });
      }

      const result = await midtransService.generateSnapToken({
        orderId: orderNumber,
        grossAmount: Number(requestData.totalAmount ?? 0),
        customerDetails: {
          firstName: customerFirstName,
          email: customerEmail,
          phone: customerPhone,
        },
        itemDetails: midtransItems,
      });

      snapToken = result.token;
    } catch (err: any) {
      strapi.log.error('Midtrans Snap token generation failed:', err);
      await rollbackDecrements(strapi, decrementedItems);
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

  async update(ctx) {
    const { id } = ctx.params;

    await this.validateQuery(ctx);

    const sanitizedQueryParams = await this.sanitizeQuery(ctx);

    // Verify ownership before updating
    const ownershipFilter = ctx.state.user
      ? { user: { documentId: { $eq: ctx.state.user.documentId } } }
      : {};

    const existing = await strapi
      .service('api::order.order')
      .findOne(id, { filters: ownershipFilter });

    if (!existing) {
      return ctx.notFound();
    }

    const entity = await strapi
      .service('api::order.order')
      .update(id, {
        ...sanitizedQueryParams,
        data: ctx.request.body,
      });

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);

    return this.transformResponse(sanitizedEntity);
  },

  async regenerateSnapToken(ctx) {
    const { documentId } = ctx.params;

    const ownershipFilter = ctx.state.user
      ? { user: { documentId: { $eq: ctx.state.user.documentId } } }
      : {};

    const order = await strapi.documents('api::order.order').findOne({
      documentId,
      ...(Object.keys(ownershipFilter).length ? { filters: ownershipFilter } : {}),
      populate: ['user', 'items', 'shippingAddress'],
    }) as any;

    if (!order) {
      return ctx.notFound('Order not found');
    }

    const shippingAddress = order.shippingAddress;

    try {
      const midtransService = strapi.service('api::midtrans.midtrans');

      const customerFirstName = shippingAddress?.firstName
        ?? order.user?.firstname
        ?? order.user?.username
        ?? 'Customer';

      const customerEmail = shippingAddress?.email ?? order.user?.email ?? '';
      const customerPhone = shippingAddress?.phone ?? order.user?.phone ?? '';

      const productItems = (order.items ?? []).map((item: any) => ({
        id: item.productDocumentId + (item.variantSku ? `-${item.variantSku}` : ''),
        price: Number(item.unitPrice ?? 0),
        quantity: Number(item.quantity ?? 0),
        name: item.productName ?? 'Product',
      }));

      const midtransItems = [...productItems];

      if (Number(order.shippingCost ?? 0) > 0) {
        midtransItems.push({
          id: 'SHIPPING',
          price: Number(order.shippingCost ?? 0),
          quantity: 1,
          name: 'Shipping Cost',
        });
      }

      if (Number(order.tax ?? 0) > 0) {
        midtransItems.push({
          id: 'TAX',
          price: Number(order.tax ?? 0),
          quantity: 1,
          name: 'Tax',
        });
      }

      if (Number(order.discount ?? 0) > 0) {
        midtransItems.push({
          id: 'DISCOUNT',
          price: -Number(order.discount ?? 0),
          quantity: 1,
          name: 'Discount',
        });
      }

      const result = await midtransService.generateSnapToken({
        orderId: order.orderNumber,
        grossAmount: Number(order.totalAmount ?? 0),
        customerDetails: {
          firstName: customerFirstName,
          email: customerEmail,
          phone: customerPhone,
        },
        itemDetails: midtransItems,
      });

      await strapi.documents('api::order.order').update({
        documentId: order.documentId,
        data: { midtransSnapToken: result.token },
      });

      strapi.log.info(`Snap token regenerated for order ${order.orderNumber}`);

      return { snapToken: result.token, redirectUrl: result.redirectUrl };
    } catch (err: any) {
      strapi.log.error('Snap token regeneration failed:', err);
      return ctx.internalServerError('Payment gateway error: ' + (err.message ?? 'Unknown'));
    }
  },

  async delete(ctx) {
    const { id } = ctx.params;

    // Verify ownership before deleting
    const ownershipFilter = ctx.state.user
      ? { user: { documentId: { $eq: ctx.state.user.documentId } } }
      : {};

    const existing = await strapi
      .service('api::order.order')
      .findOne(id, { filters: ownershipFilter });

    if (!existing) {
      return ctx.notFound();
    }

    const entity = await strapi
      .service('api::order.order')
      .delete(id);

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);

    return this.transformResponse(sanitizedEntity);
  },
}));
