FROM node:20-alpine

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

# Start server
CMD ["npm", "start"]
