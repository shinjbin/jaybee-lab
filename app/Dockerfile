FROM node:20-alpine AS build

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY --from=build /usr/src/app/dist ./dist

EXPOSE 3000

CMD ["npm", "start"]
