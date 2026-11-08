FROM node:22-bookworm-slim

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin app
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY knowledge ./knowledge
COPY cloudflare ./cloudflare
USER app
ENV NODE_ENV=production \
    AGENT_MODE=mock \
    AUTO_REPLY=off \
    DELIVERY_MODE=preview \
    PUBLIC_LAUNCH=blocked \
    DATA_DIR=/data \
    LISTEN_HOST=0.0.0.0 \
    PORT=8080
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "src/index.ts"]
