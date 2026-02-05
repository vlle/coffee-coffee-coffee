# Stage 1: Build (Keep as is)
FROM node:18-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve with Caddy
FROM caddy:2-alpine
# Copy the built files to Caddy's default directory
COPY --from=build /app/dist /usr/share/caddy
# Copy our custom Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
