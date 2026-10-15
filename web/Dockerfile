# The web app: built with Vite, served by nginx, which also forwards /api to the server (docs/ARCHITECTURE.md §4).
# Build context: the repository root (see compose.yaml).
FROM node:22.23.3-alpine3.23 AS build
WORKDIR /app
ENV LEFTHOOK=0
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
# Only what the web app and the shared schemas need; the server's (native argon2 and so on) aren't.
RUN npm ci --workspace web --workspace shared --include-workspace-root=false
COPY shared shared
COPY web web
RUN npm run build -w web

FROM nginx:1.29.8-alpine3.23
COPY web/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY web/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 8080
