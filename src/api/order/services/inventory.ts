const VARIANT_COMPONENT_UID = 'product.product-variant';
const CMP_TABLE = 'products_cmps';

function getVariantTableName(strapi: any): string {
  const meta = strapi.db.metadata.get(VARIANT_COMPONENT_UID);
  return meta.tableName;
}

async function decrementVariantInventory(
  strapi: any,
  sku: string,
  documentId: string,
  quantity: number
): Promise<boolean> {
  const tableName = getVariantTableName(strapi);
  const result = await strapi.db.connection.raw(
    `UPDATE ${tableName}
     SET inventory = inventory - :qty
     WHERE sku = :sku
       AND id IN (
         SELECT cmp_id FROM ${CMP_TABLE}
         WHERE entity_id IN (SELECT id FROM products WHERE document_id = :documentId)
           AND component_type = 'product.product-variant'
           AND field = 'variants'
       )
       AND inventory >= :qty`,
    { sku, documentId, qty: quantity }
  );
  return result?.rowCount > 0;
}

async function incrementVariantInventory(
  strapi: any,
  sku: string,
  documentId: string,
  quantity: number
): Promise<number> {
  const tableName = getVariantTableName(strapi);
  const result = await strapi.db.connection.raw(
    `UPDATE ${tableName}
     SET inventory = inventory + :qty
     WHERE sku = :sku
       AND id IN (
         SELECT cmp_id FROM ${CMP_TABLE}
         WHERE entity_id IN (SELECT id FROM products WHERE document_id = :documentId)
           AND component_type = 'product.product-variant'
           AND field = 'variants'
       )`,
    { sku, documentId, qty: quantity }
  );
  return result?.rowCount ?? 0;
}

export {
  decrementVariantInventory,
  incrementVariantInventory,
  getVariantTableName,
};
