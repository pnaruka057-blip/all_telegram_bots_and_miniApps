# Chrome + Node + Puppeteer ready base image
FROM ghcr.io/puppeteer/puppeteer:latest

# Workdir set karo (project ka root)
WORKDIR /usr/src/app

# Sirf package files pehle copy karo (cache ke liye)
COPY package*.json ./

# Dependencies install (production)
RUN npm ci --omit=dev || npm install --only=production

# Ab baaki pura project copy karo
# isme tumhare clients/, globle_helper/, index.js sab aa jayega
COPY . .

# Environment defaults (Railway / .env se override ho sakte hain)
ENV NODE_ENV=production

# WhatsApp web-js cache yahi store hoga (Railway pe /tmp writable hota hai)
ENV WEBJS_CACHE_DIR=/tmp

# Puppeteer image already Chrome laati hai, fir bhi path explicitly set kar dete hain
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

# App start command
# tumhara main file root ka index.js hai (jisme Telegraf bot launch hota hai)
CMD ["node", "index.js"]
