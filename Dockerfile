# Chrome + Node + Puppeteer ready base image
FROM ghcr.io/puppeteer/puppeteer:latest

# Workdir set karo (project ka root)
WORKDIR /usr/src/app

# Sirf package files pehle copy karo (cache ke liye)
COPY package*.json ./

# Dependencies install (production)
RUN npm ci --omit=dev || npm install --only=production

# Ab baaki pura project copy karo
COPY . .

# Environment defaults (Railway / .env se override ho sakte hain)
ENV NODE_ENV=production

# WhatsApp web-js cache yahi store hoga (Railway pe /tmp writable hota hai)
ENV WEBJS_CACHE_DIR=/tmp

# IMPORTANT:
# Yaha koi PUPPETEER_EXECUTABLE_PATH / CHROME_BIN / CHROME_PATH set NAHI karna.
# Puppeteer Docker image already apna Chromium path handle karta hai.

# App start command
CMD ["node", "index.js"]