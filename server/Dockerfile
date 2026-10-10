FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /data/releases && chown node /data/releases
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
