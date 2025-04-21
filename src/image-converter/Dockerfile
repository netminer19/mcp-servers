# Use an official Node.js runtime as a parent image
FROM node:20-bookworm-slim

# Install ImageMagick
RUN apt-get update && apt-get install -y --no-install-recommends \
    imagemagick \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

# Set the command to run the application
# Assumes files will be mounted to /workspace later via docker run --mount
CMD ["node", "dist/index.js"] 