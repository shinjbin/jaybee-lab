FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .

EXPOSE 3000

USER node

CMD ["npm", "start"]
