/**
 * Get the Dockerfile template for a plain Bun project
 */
export function getPlainBunDockerfile(): string {
    return `FROM oven/bun:slim as builder

WORKDIR /app

# Copy package files first to leverage Docker caching
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy source code
COPY . .

# Build the app
RUN bun build index.ts --target=bun --outdir=./dist

# Second stage: minimal runtime
FROM oven/bun:slim

WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Copy only the necessary files from the build stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Expose the port the app runs on
EXPOSE 3000

# Command to run the app
CMD ["bun", "dist/index.js"]`
}

