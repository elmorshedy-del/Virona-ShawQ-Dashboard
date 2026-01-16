# Use Apify's base image with Puppeteer pre-installed
FROM apify/actor-node-puppeteer-chrome:18

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy source code
COPY . ./

# Run the actor
CMD ["node", "main.js"]
