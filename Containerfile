# Production image: builds the frontend, then runs the backend, which serves
# frontend/dist itself (see backend/src/index.js). Used by compose.yaml.

FROM docker.io/library/node:20-alpine AS frontend

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# vite.config.js uses base './' for the Android WebView build; for the web we need
# absolute asset paths so deep links like /edit-diary/5 load /assets/... correctly.
RUN npx vite build --base=/

FROM docker.io/library/node:20-alpine

# backend/src/index.js looks for the frontend at ../../frontend/dist,
# so keep the repo layout: /app/backend and /app/frontend/dist
WORKDIR /app/backend
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/src ./src
COPY --from=frontend /app/frontend/dist /app/frontend/dist
# Don't inherit host permissions: a 700 dir in the build context would be
# unreadable by the node user at runtime.
RUN chmod -R a+rX src /app/frontend/dist

# Uploaded images and the Android APK live here (named volumes in compose.yaml)
RUN mkdir -p uploads downloads && chown node:node uploads downloads

USER node
EXPOSE 3001
CMD ["node", "src/index.js"]
