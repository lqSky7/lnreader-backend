FROM node:20-alpine

# Prisma's query/migration engines need OpenSSL on Alpine (musl).
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package descriptors
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma/

# Install dependencies including tsx and typescript
RUN npm ci

# Copy application source code
COPY src ./src/

# Generate Prisma client
RUN npx prisma generate

# Expose server port
EXPOSE 8080
ENV PORT=8080

# Apply pending migrations at container startup so fresh environments
# (and new deploys) never boot against an empty database, then start server.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
