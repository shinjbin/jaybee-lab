FROM node:20-alpine AS build

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

RUN sed -i 's/listen       80;/listen       8080;/' /etc/nginx/conf.d/default.conf \
    && chown -R nginx:nginx /var/cache/nginx /var/run /etc/nginx/conf.d

COPY --from=build /usr/src/app/dist /usr/share/nginx/html

USER nginx

EXPOSE 8080
