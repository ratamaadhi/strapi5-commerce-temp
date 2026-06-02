import { createStrapi } from '@strapi/strapi';
import { ProductImportService } from '../src/services/product-import';

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

    if (arg.startsWith('--file=')) {
      opts.file = arg.slice(7);
    } else if (arg === '--file') {
      opts.file = args[++i];
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--upsert') {
      opts.upsert = true;
    } else if (arg === '--create-categories') {
      opts.createCategories = true;
    } else if (arg === '--publish') {
      opts.publish = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
Bulk Product Import for Strapi 5

Usage: npm run import -- [options]

Options:
  --file <path>            Path to JSON file (required)
  --dry-run                Validate only, no database writes
  --upsert                 Update existing products by SKU (default: skip duplicates)
  --create-categories      Auto-create categories that don't exist (default: fail)
  --publish                Publish products immediately (default: draft)
  --help, -h               Show this help message

Examples:
  npm run import -- --file=./data/products.json
  npm run import -- --file=./data/products.json --dry-run
  npm run import -- --file=./data/products.json --upsert --create-categories --publish
`);
}

async function main(): Promise<void> {
  const opts = parseArgs();

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (!opts.file) {
    console.error('Error: --file is required. Use --help for usage.');
    process.exit(1);
  }

  const distDir = './dist';

  try {
    const strapiInstance = await createStrapi({ distDir }).load();

    if (opts.dryRun) {
      console.log('\n[DRY-RUN MODE] No changes will be written to the database.\n');
    }

    console.log(`\nImporting products from: ${opts.file}\n`);
    console.log('-'.repeat(60));

    const service = new ProductImportService(strapiInstance);
    const summary = await service.importProducts(opts.file, {
      dryRun: opts.dryRun,
      upsert: opts.upsert,
      createCategories: opts.createCategories,
      publish: opts.publish,
    });

    service.printSummary(summary);

    await strapiInstance.destroy();

    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nFatal error: ${message}`);
    process.exit(1);
  }
}

main();
