FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
ARG VITE_API_BASE_URL=http://localhost:3000
ARG VITE_SOCKET_PATH=/socket.io
ARG VITE_STADIA_TILE_URL=
ARG VITE_STADIA_API_KEY=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_SOCKET_PATH=$VITE_SOCKET_PATH
ENV VITE_STADIA_TILE_URL=$VITE_STADIA_TILE_URL
ENV VITE_STADIA_API_KEY=$VITE_STADIA_API_KEY
RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
