FROM node:22-slim

WORKDIR /app

# Install production and runtime dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy application source
COPY . .

# Build frontend production bundle into dist/
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.ts"]
