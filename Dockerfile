# Production image for running the maclaw CLI and server.
#
# This image builds the TypeScript sources once, installs production
# dependencies in the final stage, and defaults to `maclaw server --api-only`
# so it can be used directly on a remote host such as EC2.
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

ENTRYPOINT ["node", "dist/index.js"]
CMD ["server", "--api-only", "--port", "4000"]
