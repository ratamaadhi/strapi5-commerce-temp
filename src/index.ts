import type { Core } from '@strapi/strapi';
import * as fs from 'node:fs';
import * as path from 'node:path';

export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    strapi.server.routes([
      {
        method: 'GET',
        path: '/documentation/spec.json',
        handler: async (ctx: any) => {
          if (!strapi.plugin('documentation')) {
            return ctx.notFound('Documentation plugin is not installed');
          }
          const docService = strapi.plugin('documentation').service('documentation');
          const fullDocPath = docService.getFullDocumentationPath();
          const version = docService.getDocumentationVersion();
          const specFile = path.join(fullDocPath, version, 'full_documentation.json');

          if (fs.existsSync(specFile)) {
            ctx.type = 'application/json';
            ctx.body = JSON.parse(fs.readFileSync(specFile, 'utf-8'));
          } else {
            ctx.notFound('OpenAPI spec not found. Regenerate docs in Admin panel.');
          }
        },
        config: { auth: false },
      },
      {
        method: 'POST',
        path: '/midtrans/webhook',
        handler: async (ctx: any) => {
          const ctrl: any = strapi.controller('api::midtrans.midtrans');
          if (!ctrl) {
            strapi.log.error('Midtrans controller not loaded — try restarting Strapi');
            return ctx.internalServerError('Midtrans controller not available');
          }
          return ctrl.webhook(ctx);
        },
        config: { auth: false },
      },
      {
        method: 'POST',
        path: '/orders/:documentId/regenerate-snap-token',
        handler: async (ctx: any) => {
          const ctrl: any = strapi.controller('api::order.order');
          if (!ctrl) {
            strapi.log.error('Order controller not loaded');
            return ctx.internalServerError('Controller not available');
          }
          return ctrl.regenerateSnapToken(ctx);
        },
      },
    ]);
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    for (const dir of [strapi.dirs.app.extensions, strapi.dirs.dist.extensions]) {
      try {
        fs.mkdirSync(path.join(dir, 'documentation', 'documentation'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'documentation', 'public'), { recursive: true });
      } catch {
        // Non-fatal
      }
    }

    if (strapi.plugin('documentation')) {
      try {
        await strapi.plugin('documentation').service('documentation').generateFullDoc();
      } catch {
        // Non-fatal
      }
    }
  },
};
