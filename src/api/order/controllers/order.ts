/**
 * order controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async find(ctx) {
    await this.validateQuery(ctx);

    const sanitizedQueryParams = await this.sanitizeQuery(ctx);

    if (ctx.state.user) {
      sanitizedQueryParams.filters = {
        ...sanitizedQueryParams.filters,
        user: {
          documentId: { $eq: ctx.state.user.documentId },
        },
      };
    }

    const { results, pagination } = await strapi
      .service('api::order.order')
      .find(sanitizedQueryParams);

    const sanitizedResults = await this.sanitizeOutput(results, ctx);

    return this.transformResponse(sanitizedResults, { pagination });
  },
}));
