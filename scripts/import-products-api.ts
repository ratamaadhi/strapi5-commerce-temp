import fs from "node:fs";
import path from "node:path";

// Load .env file manually
const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const API_URL = process.env.STRAPI_API_URL;
const API_TOKEN = process.env.STRAPI_API_TOKEN;

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
  dimensions: { length: number; width: number; height: number; weight: number };
  featured?: boolean;
  categories?: string[];
  variants?: Array<{
    name: string;
    sku: string;
    price: number;
    inventory?: number;
    dimensions?: {
      length: number;
      width: number;
      height: number;
      weight: number;
    };
    attributes?: Record<string, unknown>;
  }>;
  specifications?: Array<{ label: string; value: string }>;
}

interface CLIOptions {
  file?: string;
  dryRun?: boolean;
  upsert?: boolean;
  createCategories?: boolean;
  publish?: boolean;
  help?: boolean;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--file=")) opts.file = arg.slice(7);
    else if (arg === "--file") opts.file = args[++i];
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--upsert") opts.upsert = true;
    else if (arg === "--create-categories") opts.createCategories = true;
    else if (arg === "--publish") opts.publish = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
  }

  return opts;
}

function printHelp() {
  console.log(`
Import Products via Strapi REST API

Usage:
  STRAPI_API_URL=https://your-strapi.com STRAPI_API_TOKEN=xxx npm run import:api -- [options]

Options:
  --file <path>            Path to JSON file (default: scripts/sample-products.json)
  --dry-run                Validate only, no writes
  --upsert                 Update existing products by SKU
  --create-categories      Auto-create categories
  --publish                Publish immediately
  --help, -h               Show help

Env:
  STRAPI_API_URL           Strapi server URL (default: http://localhost:1337)
  STRAPI_API_TOKEN         API token (required)

Setup:
  1. Admin Panel → Settings → API Tokens → Create new token
  2. Grant "find" and "create" access to Product and Category
  3. Set env vars and run

Examples:
  STRAPI_API_TOKEN=xxx npm run import:api
  STRAPI_API_TOKEN=xxx npm run import:api -- --file=data/products.json --publish
`);
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const url = `${API_URL}/api${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_TOKEN}`,
      ...(options.headers as Record<string, string>),
    },
  });

  const body = await res.json();

  if (!res.ok) {
    const detail =
      body.error?.details?.errors?.map((e: any) => e.message).join("; ") ||
      body.error?.message ||
      JSON.stringify(body);
    throw new Error(`API ${res.status} on ${path}: ${detail}`);
  }

  return body;
}

async function findCategory(slugOrName: string) {
  const bySlug = await apiFetch(
    `/categories?filters[slug][$eq]=${encodeURIComponent(slugOrName)}`,
  );
  if (bySlug.data?.length > 0) return bySlug.data[0];

  const byName = await apiFetch(
    `/categories?filters[name][$eq]=${encodeURIComponent(slugOrName)}`,
  );
  if (byName.data?.length > 0) return byName.data[0];

  return null;
}

async function createCategory(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/-+/g, "-");

  const res = await apiFetch("/categories", {
    method: "POST",
    body: JSON.stringify({ data: { name, slug }, status: "published" }),
  });

  return res.data;
}

async function findProductBySku(sku: string) {
  const res = await apiFetch(
    `/products?filters[sku][$eq]=${encodeURIComponent(sku)}`,
  );
  return res.data?.[0] || null;
}

async function upsertProduct(
  product: ProductInput,
  categoryIds: string[],
  options: CLIOptions,
) {
  const body: Record<string, unknown> = {
    name: product.name,
    price: product.price,
    sku: product.sku,
  };

  if (product.slug) body.slug = product.slug;
  if (product.shortDescription !== undefined)
    body.shortDescription = product.shortDescription;
  if (product.description !== undefined) body.description = product.description;
  if (product.compareAtPrice !== undefined)
    body.compareAtPrice = product.compareAtPrice;
  if (product.barcode !== undefined) body.barcode = product.barcode;
  if (product.inventory !== undefined) body.inventory = product.inventory;
  if (product.lowStockThreshold !== undefined)
    body.lowStockThreshold = product.lowStockThreshold;
  if (product.dimensions !== undefined) body.dimensions = product.dimensions;
  if (product.featured !== undefined) body.featured = product.featured;
  if (categoryIds.length > 0) body.categories = categoryIds;

  if (product.variants && product.variants.length > 0) {
    body.variants = product.variants.map((v) => ({
      name: v.name,
      sku: v.sku,
      price: v.price,
      inventory: v.inventory ?? 0,
      attributes: v.attributes ?? {},
      ...(v.dimensions ? { dimensions: v.dimensions } : {}),
    }));
  }

  if (product.specifications && product.specifications.length > 0) {
    body.specifications = product.specifications.map((s) => ({
      label: s.label,
      value: s.value,
    }));
  }

  const existing = await findProductBySku(product.sku);

  const status = options.publish ? "published" : "draft";

  if (existing) {
    if (!options.upsert) {
      return {
        status: "skipped" as const,
        reason: "SKU already exists (use --upsert to update)",
      };
    }

    await apiFetch(`/products/${existing.documentId}`, {
      method: "PUT",
      body: JSON.stringify({ data: body, status }),
    });

    return { status: "updated" as const };
  }

  await apiFetch("/products", {
    method: "POST",
    body: JSON.stringify({ data: body, status }),
  });

  return { status: "created" as const };
}

async function main() {
  const opts = parseArgs();

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (!API_TOKEN) {
    console.error("Error: STRAPI_API_TOKEN environment variable is required");
    console.error("Set it or use --help for instructions.");
    process.exit(1);
  }

  const filePath = opts.file || "scripts/sample-products.json";
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const data = JSON.parse(raw);

  if (!data.products || !Array.isArray(data.products)) {
    console.error('Error: JSON must have a "products" array');
    process.exit(1);
  }

  const products = data.products as ProductInput[];

  if (opts.dryRun) {
    console.log("\n[DRY-RUN MODE] No API calls will be made.\n");
  }

  console.log(`\nImporting ${products.length} products from: ${resolvedPath}`);
  console.log(`Target: ${API_URL}/api\n`);
  console.log("-".repeat(60));

  const startTime = Date.now();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const product of products) {
    try {
      let categoryIds: string[] = [];

      if (product.categories && product.categories.length > 0) {
        if (opts.dryRun) {
          console.log(
            `  [DRY-RUN] ${product.name}: would resolve categories: ${product.categories.join(", ")}`,
          );
          if (opts.createCategories) {
            console.log(
              `  [DRY-RUN] ${product.name}: would create missing categories`,
            );
          }
          categoryIds = product.categories.map(() => "dry-run");
        } else {
          for (const catName of product.categories) {
            let cat = await findCategory(catName);
            if (!cat) {
              if (opts.createCategories) {
                cat = await createCategory(catName);
                console.log(`  [INFO] Created category: "${catName}"`);
              } else {
                throw new Error(
                  `Category "${catName}" not found (use --create-categories)`,
                );
              }
            }
            categoryIds.push(cat.documentId);
          }
        }
      }

      if (opts.dryRun) {
        console.log(
          `  [DRY-RUN] ${product.name} (${product.sku}): would be ${opts.publish ? "published" : "drafted"}`,
        );
        created++;
        continue;
      }

      const result = await upsertProduct(product, categoryIds, opts);

      if (result.status === "created") {
        created++;
        console.log(`  [OK] ${product.name} (${product.sku})`);
      } else if (result.status === "updated") {
        updated++;
        console.log(`  [UPDATE] ${product.name} (${product.sku})`);
      } else {
        skipped++;
        console.log(
          `  [SKIP] ${product.name} (${product.sku}): ${result.reason}`,
        );
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [FAIL] ${product.name} (${product.sku}): ${msg}`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log("Import completed!");
  console.log("=".repeat(60));
  console.log(`  File:       ${resolvedPath}`);
  console.log(`  API URL:    ${API_URL}/api`);
  console.log(`  Total:      ${products.length}`);
  console.log(`  Created:    ${created}`);
  console.log(`  Updated:    ${updated}`);
  console.log(`  Skipped:    ${skipped}`);
  console.log(`  Failed:     ${failed}`);
  console.log(`  Duration:   ${duration}s`);
  console.log("=".repeat(60) + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

main();
