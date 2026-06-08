/**
 * order controller
 */

import { factories } from '@strapi/strapi';

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

    const entity = await strapi
      .service('api::order.order')
      .create({
        ...sanitizedQueryParams,
        data: {
          ...ctx.request.body,
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
