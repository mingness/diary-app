# Build context: the repository root (see compose.yaml).
FROM node:22.23.3-alpine3.23 AS build
WORKDIR /app
# Git hooks are for developers' machines, not image builds.
ENV LEFTHOOK=0
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci
COPY shared shared
COPY server server
# Only what this image ships; the web app has its own image (web/Dockerfile).
RUN npm run build -w shared && npm run build -w server && npm prune --omit=dev

FROM node:22.23.3-alpine3.23
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared/package.json shared/
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY db/migrations db/migrations
USER node
EXPOSE 3000
CMD ["node", "server/dist/main.js"]
