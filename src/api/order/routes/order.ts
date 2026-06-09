/**
 * order router
 */

import { factories } from '@strapi/strapi';

const coreRouter = factories.createCoreRouter('api::order.order');

export default {
  ...coreRouter,
  routes: [
    ...(coreRouter as any).routes,
    {
      method: 'POST',
      path: '/orders/:documentId/regenerate-snap-token',
      handler: 'order.regenerateSnapToken',
    },
  ],
};
