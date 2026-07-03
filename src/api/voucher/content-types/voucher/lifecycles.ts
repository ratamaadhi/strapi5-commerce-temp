import { errors } from '@strapi/utils';

const { ApplicationError } = errors;

function assertValidPercentage(discountType: unknown, discountValue: unknown) {
  if (discountType === 'percentage' && discountValue != null && Number(discountValue) > 100) {
    throw new ApplicationError(
      'discountValue untuk discountType "percentage" tidak boleh lebih dari 100',
    );
  }
}

export default {
  async beforeCreate(event: any) {
    const { data } = event.params;
    assertValidPercentage(data.discountType, data.discountValue);
  },

  async beforeUpdate(event: any) {
    const { data, where } = event.params;

    if (data.discountType === undefined && data.discountValue === undefined) {
      return;
    }

    const existing = await strapi.db.query('api::voucher.voucher').findOne({ where });
    const discountType = data.discountType ?? existing?.discountType;
    const discountValue = data.discountValue ?? existing?.discountValue;

    assertValidPercentage(discountType, discountValue);
  },
};
