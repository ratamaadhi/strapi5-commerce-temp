import type { Core } from '@strapi/strapi';
import * as fs from 'node:fs';
import * as path from 'node:path';

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

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
