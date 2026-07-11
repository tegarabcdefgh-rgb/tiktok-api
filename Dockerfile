FROM node:22-slim

ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg python3 \
    && rm -rf /var/lib/apt/lists/* \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN rm -f yt-dlp.exe   # opsional, hapus file Windows

EXPOSE 3000

CMD ["npm", "run", "start"]