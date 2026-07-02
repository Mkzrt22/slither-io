# Backend image for Lucky City Tycoon.
#
# IMPORTANT: build with the repository's `lucky-dungeon-tycoon/` directory as
# the build context (the docker-compose file does this), because the server
# reuses the shared game engine in ../src for save validation.

# ---- build stage -----------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install --no-audit --no-fund
# Bring in both the server sources and the shared engine, then compile.
COPY server/ ./
COPY src/ /app/src/
RUN npm run build

# ---- runtime stage ---------------------------------------------------------
FROM node:22-alpine AS run
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/server/dist ./dist
EXPOSE 8787
CMD ["node", "dist/server/src/index.js"]
