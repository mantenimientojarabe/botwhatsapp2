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
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Sesión de WhatsApp y fotos de "Resultado de planta" dentro del Volume de Railway (montado en /data).
# Si en Railway ya tienes estas variables, las de Railway mandan.
ENV SESSION_PATH=/data/whatsapp-session
ENV RESULTADOS_PATH=/data/resultados-planta
ENV CUMPLEANEROS_PATH=/data/cumpleaneros

WORKDIR /app

# Copiar dependencias e instalarlas
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el código fuente
COPY . .

CMD ["npm", "start"]
