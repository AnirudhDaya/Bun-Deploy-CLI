
/**
 * Get the Dockerfile template for a Bun project with Prisma
 */
export function getPrismaBunDockerfile(): string {
    return `FROM oven/bun:slim as builder

WORKDIR /app

# Install OpenSSL
RUN apt-get update -y && apt-get install -y openssl

# Copy package files first to leverage Docker caching
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy Prisma schema
COPY prisma ./prisma

# Generate Prisma client
RUN bunx prisma generate

# Copy Source Code 
COPY . .

# Set build-time environment variables

# Build the app
RUN bun build index.ts --target=bun --outdir=./dist

# Second stage: minimal runtime
FROM oven/bun:slim

WORKDIR /app

# Install OpenSSL in the runtime image as well
RUN apt-get update -y && apt-get install -y openssl

# Set environment to production
ENV NODE_ENV=production

# Copy only the necessary files from the build stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=deps /app/prisma ./prisma

# Copy Prisma schema and generated client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Set runtime environment variables

# Expose the port the app runs on
EXPOSE 3000

# Command to run the app
CMD ["bun", "dist/index.js"]`
}