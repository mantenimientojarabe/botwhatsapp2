FROM node:20-bookworm-slim

# Instalar Chromium y dependencias del sistema requeridas por Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Establecer variable para que puppeteer apunte al chromium del sistema
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# Copiar dependencias e instalarlas
COPY package*.json ./
RUN npm install --production

# Copiar el código fuente
COPY . .

CMD ["npm", "start"]
