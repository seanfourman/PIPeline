# The site in a container, as Railway builds and runs it (railway.json): Bun, the site's own files and the app's built
# interface, nothing else from the repository (deploy.ts gathers just these), its records on the volume mounted at
# /data. Railway sets PORT and puts HTTPS in front. The Bun image was out at least two weeks before it was picked.
FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY server.ts relay.ts store.ts ./
COPY app ./app
ENV DATA_DIR=/data
CMD ["bun", "server.ts"]
