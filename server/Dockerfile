FROM node:22-alpine
WORKDIR /app
# ffmpeg — сжимать ролики «Видео в полном экране» (без звука, до 1080p)
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /data/releases /data/status /data/fsvideo /data/addons && chown node /data/releases /data/status /data/fsvideo /data/addons
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
