import { factories } from "@strapi/strapi";

export default factories.createCoreService(
  "api::address.address",
  ({ strapi }) => ({
    async findMyAddresses(userDocumentId: string, query: any = {}) {
      const sanitizedQuery = {
        ...query,
        filters: {
          ...(query.filters || {}),
          user: { documentId: { $eq: userDocumentId } },
        } as any,
        populate: query.populate || [],
      };

      return strapi.documents("api::address.address").findMany(sanitizedQuery);
    },

    async findMyAddress(userDocumentId: string, documentId: string) {
      const address = await strapi.documents("api::address.address").findOne({
        documentId,
        populate: ["user"],
      });

      if (!address) return null;

      const user = (address as any).user;
      if (!user || user.documentId !== userDocumentId) {
        return null;
      }

      return address;
    },

    async createAddress(userDocumentId: string, data: any) {
      if (data.isDefault === true) {
        await this.resetUserDefaults(userDocumentId);
      }

      return strapi.documents("api::address.address").create({
        data: {
          ...data,
          user: userDocumentId,
        },
        populate: [],
      });
    },

    async updateAddress(userDocumentId: string, documentId: string, data: any) {
      const existing = await this.findMyAddress(userDocumentId, documentId);
      if (!existing) return null;

      const { user, ...safeData } = data;

      if (safeData.isDefault === true) {
        await this.resetUserDefaults(userDocumentId);
      }

      return strapi.documents("api::address.address").update({
        documentId,
        data: safeData,
        populate: [],
      });
    },

    async deleteAddress(userDocumentId: string, documentId: string) {
      const existing = await this.findMyAddress(userDocumentId, documentId);
      if (!existing) return null;

      return strapi.documents("api::address.address").delete({ documentId });
    },

    async makeDefault(userDocumentId: string, documentId: string) {
      const existing = await this.findMyAddress(userDocumentId, documentId);
      if (!existing) return null;

      await this.resetUserDefaults(userDocumentId);

      return strapi.documents("api::address.address").update({
        documentId,
        data: { isDefault: true },
        populate: [],
      });
    },

    async resetUserDefaults(userDocumentId: string) {
      const defaults = await strapi.documents("api::address.address").findMany({
        filters: {
          user: { documentId: { $eq: userDocumentId } },
          isDefault: { $eq: true },
        },
      });

      for (const addr of defaults) {
        await strapi.documents("api::address.address").update({
          documentId: (addr as any).documentId,
          data: { isDefault: false },
        });
      }
    },
  }),
);
