export default {
  async beforeCreate(event: any) {
    const { data } = event.params;
    const ctx = strapi.requestContext.get();
    const user = ctx?.state?.user;
    const reviewService = strapi.service('api::review.review');

    if (!user) {
      throw new Error('Authentication required');
    }

    delete data.verified;

    data.user = user.id;

    data.verified = await reviewService.checkUserPurchase(user.id, data.product);
  },

  async beforeUpdate(event: any) {
    const { data } = event.params;
    const ctx = strapi.requestContext.get();
    const user = ctx?.state?.user;
    const isAdmin = user?.role?.type === 'admin';

    if (isAdmin) return;

    if (data?.verified !== undefined) {
      strapi.log.warn('Non-admin attempted to modify verified field - stripped');
      delete data.verified;
    }
    if (data?.user !== undefined) {
      strapi.log.warn('Non-admin attempted to modify user field - stripped');
      delete data.user;
    }
  },
};
