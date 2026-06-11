# Stage 1: Build
FROM node:22-alpine AS build
RUN apk update && apk add --no-cache build-base gcc autoconf automake \
    zlib-dev libpng-dev bash vips-dev git

WORKDIR /opt/
COPY package.json package-lock.json ./
RUN npm install -g node-gyp
RUN npm config set fetch-retry-maxtimeout 600000 -g && npm ci
ENV PATH=/opt/node_modules/.bin:$PATH

WORKDIR /opt/app
COPY . .
ENV NODE_ENV=production
RUN npm run build

# Stage 2: Production
FROM node:22-alpine
ENV NODE_ENV=production

WORKDIR /opt/
COPY --from=build /opt/package.json /opt/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
ENV PATH=/opt/node_modules/.bin:$PATH

WORKDIR /opt/app
COPY --from=build /opt/app ./

RUN chown -R node:node /opt/app
USER node
EXPOSE 1337
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:1337/_health || exit 1
CMD ["npm", "run", "start"]
