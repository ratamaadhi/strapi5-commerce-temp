import { factories } from '@strapi/strapi';

export default factories.createCoreController(
  'api::address.address',
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
        .service('api::address.address')
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
        .service('api::address.address')
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
        return ctx.unauthorized('You must be logged in to save an address');
      }

      const entity = await strapi
        .service('api::address.address')
        .createAddress(ctx.state.user.documentId, requestData);

      const sanitizedEntity = await this.sanitizeOutput(entity, ctx);

      return this.transformResponse(sanitizedEntity);
    },

    async update(ctx) {
      const { id } = ctx.params;

      await this.validateQuery(ctx);

      const sanitizedQueryParams = await this.sanitizeQuery(ctx);

      if (!ctx.state.user) {
        return ctx.unauthorized('You must be logged in to update an address');
      }

      const entity = await strapi
        .service('api::address.address')
        .updateAddress(
          ctx.state.user.documentId,
          id,
          ctx.request.body.data ?? ctx.request.body,
        );

      if (!entity) {
        return ctx.notFound();
      }

      const sanitizedEntity = await this.sanitizeOutput(entity, ctx);

      return this.transformResponse(sanitizedEntity);
    },

    async delete(ctx) {
      const { id } = ctx.params;

      if (!ctx.state.user) {
        return ctx.unauthorized('You must be logged in to delete an address');
      }

      const entity = await strapi
        .service('api::address.address')
        .deleteAddress(ctx.state.user.documentId, id);

      if (!entity) {
        return ctx.notFound();
      }

      const sanitizedEntity = await this.sanitizeOutput(entity, ctx);

      return this.transformResponse(sanitizedEntity);
    },
  }),
);
