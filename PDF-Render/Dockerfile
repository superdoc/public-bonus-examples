# syntax=docker/dockerfile:1

##########
# deps — install once, reused by dev and build
##########
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

##########
# dev — used by docker-compose (vite middleware + tsx watch)
##########
FROM node:22-slim AS dev
ENV NODE_ENV=development
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The sample form is generated, not committed.
RUN npm run gen:sample
EXPOSE 8080
CMD ["npm", "run", "dev"]

##########
# build — vite build (client) + tsc (server)
##########
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run gen:sample && npm run build

##########
# runtime — production image for Cloud Run
##########
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
# Cloud Run injects PORT; default matches docker-compose.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/server/index.js"]
