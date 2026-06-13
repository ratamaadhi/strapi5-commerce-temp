import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::review.review', ({ strapi }) => ({
  async create(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return ctx.unauthorized('You must be logged in to create a review');
    }
    return super.create(ctx);
  },

  async update(ctx) {
    const { data } = ctx.request.body;
    if (data?.user || data?.verified) {
      return ctx.badRequest('user and verified fields cannot be set via API');
    }
    return super.update(ctx);
  },

  async verify(ctx) {
    const { documentId } = ctx.params;
    const { verified } = ctx.request.body;
    if (typeof verified !== 'boolean') {
      return ctx.badRequest('verified must be a boolean');
    }
    const review = await strapi.service('api::review.review').setVerified(documentId, verified);
    if (!review) return ctx.notFound('Review not found');
    return { data: review };
  },
}));
