import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::review.review', ({ strapi }) => ({
  async create(ctx) {
    const { data } = ctx.request.body;
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized('You must be logged in to create a review');
    }

    // Strip verified from request - will be computed server-side
    const { verified: _, ...cleanData } = data;
    const userId = user.id;

    // Set user to authenticated user
    cleanData.user = userId;

    // Auto-compute verified based on order history
    let verified = false;
    if (cleanData.product) {
      const reviewService = strapi.service('api::review.review');
      verified = await reviewService.checkUserPurchase(userId, cleanData.product);
    }

    cleanData.verified = verified;

    // Call default create with computed data
    ctx.request.body = { data: cleanData };
    const response = await super.create(ctx);

    strapi.log.info(`Review created by user ${userId}, verified: ${verified}`);
    return response;
  },

  async update(ctx) {
    const { data } = ctx.request.body;

    if (data) {
      // Strip fields that should only be set server-side
      const { verified: _, user: __, ...cleanData } = data;
      ctx.request.body = { data: cleanData };
      if (data.verified !== undefined || data.user !== undefined) {
        strapi.log.warn('Attempted to set protected fields (verified/user) via update endpoint - stripped');
      }
    }

    return super.update(ctx);
  },

  async verify(ctx) {
    const { documentId } = ctx.params;
    const { verified } = ctx.request.body;

    if (typeof verified !== 'boolean') {
      return ctx.badRequest('verified must be a boolean');
    }

    const reviewService = strapi.service('api::review.review');
    const review = await reviewService.setVerified(documentId, verified);

    if (!review) {
      return ctx.notFound('Review not found');
    }

    strapi.log.info(`Review ${documentId} verified set to ${verified} by admin`);
    return { data: review };
  },
}));
