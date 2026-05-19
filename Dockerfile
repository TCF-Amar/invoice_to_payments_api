# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Set dummy DATABASE_URL for prisma generate during build time
ENV DATABASE_URL=postgresql://postgres:password@localhost:5432/db

# Copy package files and Prisma configuration
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Install dependencies (including devDependencies)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the TypeScript code
RUN npm run build

# Stage 2: Production
FROM node:22-alpine AS runner

WORKDIR /app

# Set environment to production and define dummy DATABASE_URL
ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://postgres:password@localhost:5432/db

# Copy package files, Prisma schema, and configuration
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Install only production dependencies
# Note: Prisma CLI is in dependencies according to package.json, so it's installed here.
RUN npm ci --omit=dev

# Copy built artifacts from the builder stage
COPY --from=builder /app/dist ./dist

# Expose the application port
EXPOSE 3000

# Start the application using the start script in package.json
CMD ["npm", "start"]
