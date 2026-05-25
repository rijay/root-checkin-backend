FROM node:22-alpine

RUN apk add --no-cache tzdata ca-certificates \
  && update-ca-certificates \
  && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
  && echo Asia/Shanghai > /etc/timezone

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

COPY . .

ENV NODE_ENV=production
ENV PORT=80

EXPOSE 80

CMD ["node", "src/server.js"]
