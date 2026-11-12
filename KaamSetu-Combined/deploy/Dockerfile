# Build from the project root:  docker build -f deploy/Dockerfile -t kaamsetu .
# One image serves the API and the static frontend. Zero npm dependencies, so nothing is downloaded at build time except the base image.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY kaamsetu-backend/package.json kaamsetu-backend/package.json
COPY kaamsetu-backend/src kaamsetu-backend/src
COPY kaamsetu-backend/scripts kaamsetu-backend/scripts
COPY kaamsetu-frontend kaamsetu-frontend
RUN mkdir -p /data && chown -R node:node /data /app
USER node
WORKDIR /app/kaamsetu-backend
ENV HOST=0.0.0.0 PORT=3000 DB_PATH=/data/kaamsetu.db STATIC_DIR=/app/kaamsetu-frontend
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node scripts/healthcheck.js
CMD ["node", "--no-warnings", "src/server.js"]
