import fs from 'node:fs';
import path from 'node:path';
import type { Core } from '@strapi/strapi';

interface ImportOptions {
  dryRun?: boolean;
  upsert?: boolean;
  createCategories?: boolean;
  publish?: boolean;
}

interface ProductInput {
  name: string;
  slug?: string;
  shortDescription?: string;
  description?: string;
  price: number;
  compareAtPrice?: number;
  sku: string;
  barcode?: string;
  inventory?: number;
  lowStockThreshold?: number;
  weight?: number;
  featured?: boolean;
  categories?: string[];
  variants?: Array<{
    name: string;
    sku: string;
    price: number;
    inventory?: number;
    attributes?: Record<string, unknown>;
  }>;
  specifications?: Array<{
    label: string;
    value: string;
  }>;
}

interface ProductsJSON {
  products: ProductInput[];
}

interface ProductResult {
  name: string;
  sku: string;
  status: 'success' | 'skipped' | 'failed';
  reason?: string;
}

interface ImportSummary {
  file: string;
  total: number;
  success: number;
  skipped: number;
  failed: number;
  results: ProductResult[];
  duration: number;
}

export class ProductImportService {
  constructor(private strapi: Core.Strapi) {}

  private readJSON(filePath: string): ProductsJSON {
    const resolved = path.resolve(filePath);

    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${resolved}`);
    }

    const raw = fs.readFileSync(resolved, 'utf-8');

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Invalid JSON in file: ${resolved}`);
    }

    if (!data || typeof data !== 'object') {
      throw new Error('JSON root must be an object');
    }

    const obj = data as Record<string, unknown>;

    if (!Array.isArray(obj.products)) {
      throw new Error('JSON must have a "products" array');
    }

    return data as ProductsJSON;
  }

  private validateProduct(product: ProductInput): string | null {
    if (!product.name || typeof product.name !== 'string' || product.name.trim().length === 0) {
      return 'Missing required field: name';
    }
    if (product.price === undefined || product.price === null || typeof product.price !== 'number' || product.price < 0) {
      return 'Missing or invalid required field: price (must be >= 0)';
    }
    if (!product.sku || typeof product.sku !== 'string' || product.sku.trim().length === 0) {
      return 'Missing required field: sku';
    }

    if (product.variants && Array.isArray(product.variants)) {
      for (let i = 0; i < product.variants.length; i++) {
        const v = product.variants[i];
        if (!v.name || !v.sku || v.price === undefined || v.price === null || typeof v.price !== 'number' || v.price < 0) {
          return `Variant #${i + 1}: missing required field (name, sku, price >= 0)`;
        }
      }
    }

    return null;
  }

  private async findCategoryBySlugOrName(value: string) {
    const bySlug = await this.strapi.documents('api::category.category').findFirst({
      filters: { slug: { $eq: value } },
    });

    if (bySlug) return bySlug;

    const byName = await this.strapi.documents('api::category.category').findFirst({
      filters: { name: { $eq: value } },
    });

    return byName;
  }

  private async createCategory(name: string, publish: boolean): Promise<{ documentId: string }> {
    const data: Record<string, unknown> = {
      name,
      slug: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    };

    if (publish) {
      data.publishedAt = new Date().toISOString();
    }

    return this.strapi.documents('api::category.category').create(data);
  }

  private async resolveCategories(
    categoryNames: string[] | undefined,
    options: ImportOptions,
  ): Promise<{ documentId: string }[] | string | null> {
    if (!categoryNames || categoryNames.length === 0) {
      return [];
    }

    const resolved: { documentId: string }[] = [];

    for (const name of categoryNames) {
      const existing = await this.findCategoryBySlugOrName(name);

      if (existing) {
        resolved.push({ documentId: existing.documentId });
      } else if (options.createCategories) {
        const created = await this.createCategory(name, !!options.publish);
        resolved.push({ documentId: created.documentId });
        console.log(`  [INFO] Auto-created category: "${name}"`);
      } else {
        return `Category "${name}" not found (use --create-categories to auto-create)`;
      }
    }

    return resolved;
  }

  private buildProductBody(product: ProductInput, categoryIds: { documentId: string }[], options: ImportOptions) {
    const body: Record<string, unknown> = {
      name: product.name,
      price: product.price,
      sku: product.sku,
    };

    if (product.slug) body.slug = product.slug;
    if (product.shortDescription !== undefined) body.shortDescription = product.shortDescription;
    if (product.description !== undefined) body.description = product.description;
    if (product.compareAtPrice !== undefined) body.compareAtPrice = product.compareAtPrice;
    if (product.barcode !== undefined) body.barcode = product.barcode;
    if (product.inventory !== undefined) body.inventory = product.inventory;
    if (product.lowStockThreshold !== undefined) body.lowStockThreshold = product.lowStockThreshold;
    if (product.weight !== undefined) body.weight = product.weight;
    if (product.featured !== undefined) body.featured = product.featured;

    body.categories = categoryIds;

    if (product.variants && product.variants.length > 0) {
      body.variants = product.variants.map((v) => ({
        name: v.name,
        sku: v.sku,
        price: v.price,
        inventory: v.inventory ?? 0,
        attributes: v.attributes ?? {},
      }));
    }

    if (product.specifications && product.specifications.length > 0) {
      body.specifications = product.specifications.map((s) => ({
        label: s.label,
        value: s.value,
      }));
    }

    if (options.publish) {
      body.publishedAt = new Date().toISOString();
    }

    return body;
  }

  async importProducts(filePath: string, options: ImportOptions = {}): Promise<ImportSummary> {
    const startTime = Date.now();
    const results: ProductResult[] = [];

    const data = this.readJSON(filePath);

    for (const product of data.products) {
      const failed: ProductResult = { name: product.name, sku: product.sku, status: 'failed' };

      const validationError = this.validateProduct(product);
      if (validationError) {
        failed.reason = validationError;
        results.push(failed);
        if (options.dryRun) {
          console.log(`  [DRY-RUN] ${product.name} (${product.sku}): would fail — ${validationError}`);
        } else {
          console.log(`  [FAIL] ${product.name} (${product.sku}): ${validationError}`);
        }
        continue;
      }

      const existing = await this.strapi.documents('api::product.product').findFirst({
        filters: { sku: { $eq: product.sku } },
      });

      if (existing) {
        if (options.upsert) {
          const categoryResult = await this.resolveCategories(product.categories, options);
          if (typeof categoryResult === 'string') {
            failed.reason = categoryResult;
            results.push(failed);
            console.log(`  [FAIL] ${product.name} (${product.sku}): ${categoryResult}`);
            continue;
          }

          if (options.dryRun) {
            results.push({ name: product.name, sku: product.sku, status: 'success' });
            console.log(`  [DRY-RUN] ${product.name} (${product.sku}): would upsert`);
          } else {
            const body = this.buildProductBody(product, categoryResult, options);
            await this.strapi.documents('api::product.product').update(existing.documentId, body);
            results.push({ name: product.name, sku: product.sku, status: 'success' });
            console.log(`  [UPSERT] ${product.name} (${product.sku})`);
          }
        } else {
          results.push({ name: product.name, sku: product.sku, status: 'skipped', reason: `SKU "${product.sku}" already exists` });
          if (options.dryRun) {
            console.log(`  [DRY-RUN] ${product.name} (${product.sku}): would skip — SKU already exists`);
          } else {
            console.log(`  [SKIP] ${product.name} (${product.sku}): SKU already exists`);
          }
        }
        continue;
      }

      const categoryResult = await this.resolveCategories(product.categories, options);
      if (typeof categoryResult === 'string') {
        failed.reason = categoryResult;
        results.push(failed);
        console.log(`  [FAIL] ${product.name} (${product.sku}): ${categoryResult}`);
        continue;
      }

      if (options.dryRun) {
        results.push({ name: product.name, sku: product.sku, status: 'success' });
        console.log(`  [DRY-RUN] ${product.name} (${product.sku}): would create`);
        continue;
      }

      try {
        const body = this.buildProductBody(product, categoryResult, options);
        await this.strapi.documents('api::product.product').create(body);
        results.push({ name: product.name, sku: product.sku, status: 'success' });
        console.log(`  [OK] ${product.name} (${product.sku})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.reason = message;
        results.push(failed);
        console.log(`  [FAIL] ${product.name} (${product.sku}): ${message}`);
      }
    }

    const durationMs = Date.now() - startTime;

    const success = results.filter((r) => r.status === 'success').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    return {
      file: path.resolve(filePath),
      total: data.products.length,
      success,
      skipped,
      failed,
      results,
      duration: durationMs,
    };
  }

  printSummary(summary: ImportSummary): void {
    console.log('\n' + '='.repeat(60));
    console.log('Import completed!');
    console.log('='.repeat(60));
    console.log(`  File:       ${summary.file}`);
    console.log(`  Total:      ${summary.total}`);
    console.log(`  Success:    ${summary.success}`);
    console.log(`  Skipped:    ${summary.skipped}`);
    console.log(`  Failed:     ${summary.failed}`);

    const failures = summary.results.filter((r) => r.status === 'failed');
    if (failures.length > 0) {
      console.log('');
      for (const f of failures) {
        console.log(`    - [${f.name}] ${f.reason}`);
      }
    }

    const skippedItems = summary.results.filter((r) => r.status === 'skipped');
    if (skippedItems.length > 0) {
      console.log('');
      for (const s of skippedItems) {
        console.log(`    - [${s.name}] ${s.reason}`);
      }
    }

    console.log(`  Duration:   ${(summary.duration / 1000).toFixed(1)}s`);
    console.log('='.repeat(60) + '\n');
  }
}
