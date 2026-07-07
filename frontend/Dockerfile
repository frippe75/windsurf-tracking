# syntax=docker/dockerfile:1
FROM harbor.tclab.org/dockerhub/library/node:22-slim AS builder

ARG APP_VERSION=0.0.0-dev
# Empty = same-origin; ingress routes /api and /auth to the backend service
ARG VITE_BACKEND_URL=
ENV VITE_APP_VERSION=$APP_VERSION
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

WORKDIR /build
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm install
COPY . .
RUN npm run build

FROM harbor.tclab.org/dockerhub/library/nginx:1-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /build/dist /usr/share/nginx/html

EXPOSE 80
