const VARIANT_COMPONENT_UID = 'product.product-variant';

interface VariantInventoryResult {
  success: boolean;
  affected: number;
}

function getVariantTableName(strapi: any): string {
  const meta = strapi.db.metadata.get(VARIANT_COMPONENT_UID);
  return meta.tableName;
}

async function decrementVariantInventory(
  strapi: any,
  variantId: number,
  quantity: number
): Promise<VariantInventoryResult> {
  const tableName = getVariantTableName(strapi);
  const affected = await strapi.db.connection(tableName)
    .where('id', variantId)
    .where('inventory', '>=', quantity)
    .decrement('inventory', quantity);
  return { success: affected > 0, affected };
}

async function incrementVariantInventory(
  strapi: any,
  variantId: number,
  quantity: number
): Promise<number> {
  const tableName = getVariantTableName(strapi);
  return strapi.db.connection(tableName)
    .where('id', variantId)
    .increment('inventory', quantity);
}

export {
  decrementVariantInventory,
  incrementVariantInventory,
  getVariantTableName,
};
