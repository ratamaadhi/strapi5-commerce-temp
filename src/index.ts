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

          // 1. POST /orders/{documentId}/cancel
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
                  description:
                    'Bad Request – order cannot be cancelled or refund required',
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

          // 2. POST /orders/{documentId}/regenerate-snap-token
          spec.paths['/orders/{documentId}/regenerate-snap-token'] = {
            post: {
              tags: ['Order'],
              operationId: 'post/orders/{documentId}/regenerateSnapToken',
              parameters: [
                {
                  name: 'documentId',
                  in: 'path',
                  description: 'Document ID of the order',
                  deprecated: false,
                  required: true,
                  schema: { type: 'string' },
                },
              ],
              responses: {
                '200': {
                  description:
                    'Snap token regenerated successfully. Returns snapToken and redirectUrl.',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          snapToken: { type: 'string' },
                          redirectUrl: { type: 'string' },
                        },
                      },
                    },
                  },
                },
                '400': {
                  description:
                    'Bad Request – order cancelled/refunded or payment already processed',
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

          // 3. POST /orders/{documentId}/retry
          spec.paths['/orders/{documentId}/retry'] = {
            post: {
              tags: ['Order'],
              operationId: 'post/orders/{documentId}/retry',
              parameters: [
                {
                  name: 'documentId',
                  in: 'path',
                  description:
                    'Document ID of the failed order to retry',
                  deprecated: false,
                  required: true,
                  schema: { type: 'string' },
                },
              ],
              responses: {
                '200': {
                  description:
                    'New order created successfully as a retry of a failed payment',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/OrderResponse' },
                    },
                  },
                },
                '400': {
                  description:
                    'Bad Request – order payment did not fail, max retry exceeded, or insufficient stock',
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

          // 4. POST /midtrans/webhook
          spec.paths['/midtrans/webhook'] = {
            post: {
              tags: ['Midtrans'],
              operationId: 'post/midtrans/webhook',
              security: [],
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        order_id: {
                          type: 'string',
                          description: 'Order number (ORD-xxx)',
                        },
                        transaction_id: { type: 'string' },
                        transaction_status: {
                          type: 'string',
                          description:
                            'settlement, capture, pending, deny, expire, cancel, refund, partial_refund',
                        },
                        payment_type: { type: 'string' },
                        gross_amount: { type: 'string' },
                        status_code: { type: 'string' },
                        signature_key: { type: 'string' },
                      },
                    },
                  },
                },
              },
              responses: {
                '200': {
                  description: 'Webhook acknowledged',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          status: { type: 'string', example: 'ok' },
                          message: { type: 'string' },
                        },
                      },
                    },
                  },
                },
                '403': {
                  description: 'Invalid signature',
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

          // 5. GET /users/me/addresses
          spec.paths['/users/me/addresses'] = {
            get: {
              tags: ['Address'],
              operationId: 'get/users/me/addresses',
              responses: {
                '200': {
                  description: 'List of user addresses',
                  content: {
                    'application/json': {
                      schema: {
                        $ref: '#/components/schemas/AddressListResponse',
                      },
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
            post: {
              tags: ['Address'],
              operationId: 'post/users/me/addresses',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/AddressRequest',
                    },
                  },
                },
              },
              responses: {
                '200': {
                  description: 'Address created',
                  content: {
                    'application/json': {
                      schema: {
                        $ref: '#/components/schemas/AddressResponse',
                      },
                    },
                  },
                },
                '400': {
                  description: 'Bad Request',
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

          // 6. GET /users/me/addresses/{documentId}
          spec.paths['/users/me/addresses/{documentId}'] = {
            get: {
              tags: ['Address'],
              operationId: 'get/users/me/addresses/{documentId}',
              parameters: [
                {
                  name: 'documentId',
                  in: 'path',
                  description: 'Document ID of the address',
                  deprecated: false,
                  required: true,
                  schema: { type: 'string' },
                },
              ],
              responses: {
                '200': {
                  description: 'Address details',
                  content: {
                    'application/json': {
                      schema: {
                        $ref: '#/components/schemas/AddressResponse',
                      },
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
            put: {
              tags: ['Address'],
              operationId: 'put/users/me/addresses/{documentId}',
              parameters: [
                {
                  name: 'documentId',
                  in: 'path',
                  description: 'Document ID of the address',
                  deprecated: false,
                  required: true,
                  schema: { type: 'string' },
                },
              ],
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/AddressRequest',
                    },
                  },
                },
              },
              responses: {
                '200': {
                  description: 'Address updated',
                  content: {
                    'application/json': {
                      schema: {
                        $ref: '#/components/schemas/AddressResponse',
                      },
                    },
                  },
                },
                '400': {
                  description: 'Bad Request',
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
            delete: {
              tags: ['Address'],
              operationId: 'delete/users/me/addresses/{documentId}',
              parameters: [
                {
                  name: 'documentId',
                  in: 'path',
                  description: 'Document ID of the address',
                  deprecated: false,
                  required: true,
                  schema: { type: 'string' },
                },
              ],
              responses: {
                '200': {
                  description: 'Address deleted',
                  content: {
                    'application/json': {
                      schema: {
                        $ref: '#/components/schemas/AddressResponse',
                      },
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

          // 7. PATCH /users/me/addresses/{documentId}/make-default
          spec.paths['/users/me/addresses/{documentId}/make-default'] = {
            patch: {
              tags: ['Address'],
              operationId: 'patch/users/me/addresses/{documentId}/make-default',
              parameters: [
                {
                  name: 'documentId',
                  in: 'path',
                  description:
                    'Document ID of the address to set as default',
                  deprecated: false,
                  required: true,
                  schema: { type: 'string' },
                },
              ],
              responses: {
                '200': {
                  description: 'Address set as default',
                  content: {
                    'application/json': {
                      schema: {
                        $ref: '#/components/schemas/AddressResponse',
                      },
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
          strapi.log.info('Custom endpoints injected into OpenAPI spec');
        }
      } catch {
        // Non-fatal
      }
    }

    // UNIQUE(user_id, product_id) on wishlist_items
    try {
      await strapi.db.connection.raw(
        'CREATE UNIQUE INDEX IF NOT EXISTS wishlist_items_user_product_unique ON wishlist_items(user_id, product_id)'
      );
    } catch (err: any) {
      strapi.log.warn(`Could not create wishlist unique constraint: ${err.message}`);
    }
  },
};
