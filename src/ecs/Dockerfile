# Build stage
FROM public.ecr.aws/docker/library/node:22-alpine AS build

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Install dependencies
RUN npm ci

# Copy the rest of the code
COPY . .

# Build the app
RUN npm run build

# Production stage
FROM public.ecr.aws/nginx/nginx:stable-alpine

# # Copy the built assets from the build stage
COPY --from=build /app/build /usr/share/nginx/html

# # Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# # Copy the entrypoint script
COPY entrypoint.sh /entrypoint.sh

# Convert line endings to unix style
RUN sed -i 's/\r$//' /entrypoint.sh

# Make the script executable
RUN chmod +x /entrypoint.sh

# Expose port 80
EXPOSE 80

# Use the script as the entrypoint
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]

# Start nginx
CMD ["nginx", "-g", "daemon off;"]