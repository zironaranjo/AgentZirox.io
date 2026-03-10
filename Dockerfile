FROM node:20-bullseye-slim

# Directorio de trabajo en el contenedor
WORKDIR /app

# Instalamos las herramientas del sistema operativo necesarias para que
# los paquetes en C++ como better-sqlite3 puedan compilar si lo necesitan (node-gyp)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copiamos las dependencias primero para aprovechar el caché de Docker
COPY package.json package-lock.json ./

# Instalamos todas las dependencias
RUN npm ci

# Copiamos todo el resto del código del proyecto
COPY . .

# Construimos la interfaz web (Next.js)
RUN npm run build

# Exponemos el puerto en el que vivirá nuestro Custom Server
EXPOSE 3000

# Variables de entorno
ENV NODE_ENV=production
ENV PORT=3000

# Comando para encender a Ziro (Bot + Next.js)
CMD ["node", "server.js"]
