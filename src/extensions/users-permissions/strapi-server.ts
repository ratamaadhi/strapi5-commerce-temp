export default (plugin: any) => {
  const routes = plugin.routes["content-api"].routes;

  // ── Controllers ──────────────────────────────────────────

  plugin.controllers.address = {
    async find(ctx: any) {
      const userDocumentId = ctx.state.user?.documentId;
      if (!userDocumentId) {
        return ctx.unauthorized("You must be logged in");
      }

      const addresses = await strapi
        .service("api::address.address")
        .findMyAddresses(userDocumentId);

      const sanitized = await strapi.contentAPI.sanitize.output(
        addresses,
        strapi.getModel("api::address.address"),
      );

      ctx.body = sanitized;
    },

    async findOne(ctx: any) {
      const userDocumentId = ctx.state.user?.documentId;
      if (!userDocumentId) {
        return ctx.unauthorized("You must be logged in");
      }

      const { documentId } = ctx.params;

      const address = await strapi
        .service("api::address.address")
        .findMyAddress(userDocumentId, documentId);

      if (!address) {
        return ctx.notFound("Address not found");
      }

      const sanitized = await strapi.contentAPI.sanitize.output(
        address,
        strapi.getModel("api::address.address"),
      );

      ctx.body = sanitized;
    },

    async create(ctx: any) {
      const userDocumentId = ctx.state.user?.documentId;
      if (!userDocumentId) {
        return ctx.unauthorized("You must be logged in");
      }

      const requestData = ctx.request.body.data ?? ctx.request.body;
      const sanitizedInput = await strapi.contentAPI.sanitize.input(
        requestData,
        strapi.getModel("api::address.address"),
      );

      const address = await strapi
        .service("api::address.address")
        .createAddress(userDocumentId, sanitizedInput);

      const sanitized = await strapi.contentAPI.sanitize.output(
        address,
        strapi.getModel("api::address.address"),
      );

      ctx.body = sanitized;
    },

    async update(ctx: any) {
      const userDocumentId = ctx.state.user?.documentId;
      if (!userDocumentId) {
        return ctx.unauthorized("You must be logged in");
      }

      const { documentId } = ctx.params;
      const requestData = ctx.request.body.data ?? ctx.request.body;
      const sanitizedInput = await strapi.contentAPI.sanitize.input(
        requestData,
        strapi.getModel("api::address.address"),
      );

      const address = await strapi
        .service("api::address.address")
        .updateAddress(userDocumentId, documentId, sanitizedInput);

      if (!address) {
        return ctx.notFound("Address not found");
      }

      const sanitized = await strapi.contentAPI.sanitize.output(
        address,
        strapi.getModel("api::address.address"),
      );

      ctx.body = sanitized;
    },

    async delete(ctx: any) {
      const userDocumentId = ctx.state.user?.documentId;
      if (!userDocumentId) {
        return ctx.unauthorized("You must be logged in");
      }

      const { documentId } = ctx.params;

      const address = await strapi
        .service("api::address.address")
        .deleteAddress(userDocumentId, documentId);

      if (!address) {
        return ctx.notFound("Address not found");
      }

      const sanitized = await strapi.contentAPI.sanitize.output(
        address,
        strapi.getModel("api::address.address"),
      );

      ctx.body = sanitized;
    },

    async makeDefault(ctx: any) {
      const userDocumentId = ctx.state.user?.documentId;
      if (!userDocumentId) {
        return ctx.unauthorized("You must be logged in");
      }

      const { documentId } = ctx.params;

      const address = await strapi
        .service("api::address.address")
        .makeDefault(userDocumentId, documentId);

      if (!address) {
        return ctx.notFound("Address not found");
      }

      const sanitized = await strapi.contentAPI.sanitize.output(
        address,
        strapi.getModel("api::address.address"),
      );

      ctx.body = sanitized;
    },
  };

  // ── Routes ───────────────────────────────────────────────

  routes.push(
    {
      method: "GET",
      path: "/users/me/addresses",
      handler: "address.find",
      config: { prefix: "" },
    },
    {
      method: "GET",
      path: "/users/me/addresses/:documentId",
      handler: "address.findOne",
      config: { prefix: "" },
    },
    {
      method: "POST",
      path: "/users/me/addresses",
      handler: "address.create",
      config: { prefix: "" },
    },
    {
      method: "PUT",
      path: "/users/me/addresses/:documentId",
      handler: "address.update",
      config: { prefix: "" },
    },
    {
      method: "DELETE",
      path: "/users/me/addresses/:documentId",
      handler: "address.delete",
      config: { prefix: "" },
    },
    {
      method: "PATCH",
      path: "/users/me/addresses/:documentId/make-default",
      handler: "address.makeDefault",
      config: { prefix: "" },
    },
  );

  return plugin;
};
