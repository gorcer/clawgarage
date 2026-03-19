FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY public/ ./public/

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 3006

# Start the app
CMD ["node", "src/index.js"]
