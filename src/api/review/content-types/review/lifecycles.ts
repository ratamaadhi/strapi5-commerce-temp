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

    // Set anonymous review state
    data.isAnonymous = data.isAnonymous ?? false;
    data.displayName = data.isAnonymous ? null : (user.username || null);

    // Baca product documentId dari raw request body (data.product sudah dikonversi oleh Document Service)
    const rawBody = ctx?.request?.body;
    const productDocumentId = rawBody?.data?.product || rawBody?.product;
    data.verified = await reviewService.checkUserPurchase(user.id, productDocumentId);
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
    if (data?.isAnonymous !== undefined) {
      strapi.log.warn('Non-admin attempted to modify isAnonymous field - stripped');
      delete data.isAnonymous;
    }
  },
};
