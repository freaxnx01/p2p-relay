FROM node:lts-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js lib.js ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "require('net').connect(8080,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
