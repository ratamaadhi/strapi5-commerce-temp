import type { Schema, Struct } from '@strapi/strapi';

export interface CommonAddress extends Struct.ComponentSchema {
  collectionName: 'components_common_addresses';
  info: {
    displayName: 'address';
    icon: 'house';
  };
  attributes: {
    addressLine1: Schema.Attribute.Text & Schema.Attribute.Required;
    addressLine2: Schema.Attribute.Text;
    city: Schema.Attribute.String & Schema.Attribute.Required;
    country: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'Indonesia'>;
    firstName: Schema.Attribute.String & Schema.Attribute.Required;
    lastName: Schema.Attribute.String & Schema.Attribute.Required;
    phone: Schema.Attribute.String & Schema.Attribute.Required;
    postalCode: Schema.Attribute.String & Schema.Attribute.Required;
    state: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface ProductCartItem extends Struct.ComponentSchema {
  collectionName: 'components_product_cart_items';
  info: {
    displayName: 'cartItem';
    icon: 'shoppingCart';
  };
  attributes: {
    quantity: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: '1';
        },
        string
      >;
    variantId: Schema.Attribute.String;
  };
}

export interface ProductOrderItem extends Struct.ComponentSchema {
  collectionName: 'components_product_order_items';
  info: {
    displayName: 'orderItem';
    icon: 'bulletList';
  };
  attributes: {
    productName: Schema.Attribute.String & Schema.Attribute.Required;
    productSku: Schema.Attribute.Text;
    quantity: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: '1';
        },
        string
      >;
    totalPrice: Schema.Attribute.Decimal & Schema.Attribute.Required;
    unitPrice: Schema.Attribute.Decimal & Schema.Attribute.Required;
    variantInfo: Schema.Attribute.Text;
  };
}

export interface ProductProductVariant extends Struct.ComponentSchema {
  collectionName: 'components_product_product_variants';
  info: {
    displayName: 'productVariant';
    icon: 'store';
  };
  attributes: {
    attributes: Schema.Attribute.JSON;
    inventory: Schema.Attribute.BigInteger &
      Schema.Attribute.SetMinMax<
        {
          min: '0';
        },
        string
      > &
      Schema.Attribute.DefaultTo<'0'>;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    price: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    sku: Schema.Attribute.Text & Schema.Attribute.Unique;
  };
}

export interface ProductSpecification extends Struct.ComponentSchema {
  collectionName: 'components_product_specifications';
  info: {
    displayName: 'specification';
    icon: 'book';
  };
  attributes: {
    label: Schema.Attribute.Text & Schema.Attribute.Required;
    value: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'common.address': CommonAddress;
      'product.cart-item': ProductCartItem;
      'product.order-item': ProductOrderItem;
      'product.product-variant': ProductProductVariant;
      'product.specification': ProductSpecification;
    }
  }
}
