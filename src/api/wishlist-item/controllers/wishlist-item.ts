import { factories } from '@strapi/strapi';

export default factories.createCoreController(
  'api::wishlist-item.wishlist-item',
  ({ strapi }) => ({
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
        .service('api::wishlist-item.wishlist-item')
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
        .service('api::wishlist-item.wishlist-item')
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

      if (!ctx.state.user) {
        return ctx.unauthorized('You must be logged in');
      }

      const entity = await strapi
        .service('api::wishlist-item.wishlist-item')
        .create({
          ...sanitizedQueryParams,
          data: {
            ...requestData,
            user: ctx.state.user.documentId,
          },
        });

      const sanitizedEntity = await this.sanitizeOutput(entity, ctx);

      return this.transformResponse(sanitizedEntity);
    },

    async delete(ctx) {
      const { id } = ctx.params;

      const ownershipFilter = ctx.state.user
        ? { user: { documentId: { $eq: ctx.state.user.documentId } } }
        : {};

      const existing = await strapi
        .service('api::wishlist-item.wishlist-item')
        .findOne(id, { filters: ownershipFilter });

      if (!existing) {
        return ctx.notFound();
      }

      const entity = await strapi
        .service('api::wishlist-item.wishlist-item')
        .delete(id);

      const sanitizedEntity = await this.sanitizeOutput(entity, ctx);

      return this.transformResponse(sanitizedEntity);
    },
  }),
);
