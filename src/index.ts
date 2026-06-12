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

        // Inject custom cancel endpoint into generated spec
        const docService = strapi.plugin('documentation').service('documentation');
        const specFile = path.join(
          docService.getFullDocumentationPath(),
          docService.getDocumentationVersion(),
          'full_documentation.json',
        );

        if (fs.existsSync(specFile)) {
          const spec = JSON.parse(fs.readFileSync(specFile, 'utf-8'));
          spec.paths['/orders/{documentId}/cancel'] = {
            post: {
              tags: ['Order'],
              operationId: 'post/orders/{documentId}/cancel',
              parameters: [
                {
                  name: 'documentId',
                  in: 'path',
                  description: 'Document ID of the order to cancel',
                  deprecated: false,
                  required: true,
                  schema: { type: 'string' },
                },
              ],
              responses: {
                '200': {
                  description: 'Order cancelled successfully',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/OrderResponse' },
                    },
                  },
                },
                '400': {
                  description: 'Bad Request – order cannot be cancelled or refund required',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Error' },
                    },
                  },
                },
                '401': {
                  description: 'Unauthorized',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Error' },
                    },
                  },
                },
                '403': {
                  description: 'Forbidden',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Error' },
                    },
                  },
                },
                '404': {
                  description: 'Not Found',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Error' },
                    },
                  },
                },
                '500': {
                  description: 'Internal Server Error',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Error' },
                    },
                  },
                },
              },
            },
          };
          fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));
          strapi.log.info('Cancel endpoint injected into OpenAPI spec');
        }
      } catch {
        // Non-fatal
      }
    }
  },
};
