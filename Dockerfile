FROM node:22-alpine AS build-angular

WORKDIR /build
COPY client/package*.json ./client/
RUN npm --prefix client ci
COPY client/ ./client/
RUN npm --prefix client run build


FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js game-manager.js questions.json ./
COPY public/ ./public/
COPY --from=build-angular /build/client/dist/ ./client/dist/

EXPOSE 3000
CMD ["node", "server.js"]
