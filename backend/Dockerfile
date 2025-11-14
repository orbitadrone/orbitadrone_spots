# syntax=docker/dockerfile:1
FROM node:18-alpine

WORKDIR /app

# Use a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Copy package files and install dependencies
COPY --chown=appuser:appgroup package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source code
COPY --chown=appuser:appgroup *.js ./

# Expose port and set environment variables
ENV PORT=3000
ENV FIREBASE_AUTH_REQUIRED=true
EXPOSE 3000

# Run the application
CMD ["node", "server.js"]

