FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2
COPY --from=build /app/dist /srv
# "deploy" is an additional build context set in docker-compose.prod.yml.
COPY --from=deploy Caddyfile /etc/caddy/Caddyfile
