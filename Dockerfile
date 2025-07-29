# Stage 1: Build
FROM rust:1.88-alpine AS builder
WORKDIR /app

# Install musl-dev for static linking and OpenSSL dependencies
RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static

# Copy manifests
COPY Cargo.toml Cargo.lock ./

# Create a dummy src/main.rs to build dependencies
RUN mkdir src
COPY src/ ./src/
RUN cargo build --release

# Stage 2: Production
FROM alpine:3.18 AS runner
WORKDIR /app

# Install CA certificates for HTTPS requests
RUN apk add --no-cache ca-certificates

# Copy the binary from builder stage
COPY --from=builder /app/target/release/oneprime-resolver ./

# Expose port (adjust as needed)
EXPOSE 3001

CMD ["./oneprime-resolver"]