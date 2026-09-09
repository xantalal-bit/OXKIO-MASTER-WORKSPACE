FROM node:22-alpine3.24 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Etapa compartida: mismo contenido de aplicacion para el target HTTP
# (`runtime`, mas abajo) y para el target de backup (`backup`, 5C.7B.6B.3D).
# Ninguno de los dos targets duplica estas COPY.
FROM node:22-alpine3.24 AS app
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node backend ./backend
RUN find /app/backend -type d -exec chmod u+w {} +
COPY --chown=node:node app ./app
COPY --chown=node:node package.json ./

# Target de backup (5C.7B.6B.3D, OFFLINE — nunca conectado a Neon en este
# repositorio). Misma base Alpine 3.24 que el target HTTP; unica adicion es
# el cliente PostgreSQL 18 para poder invocar `pg_dump`/`pg_restore`/`psql`
# desde un futuro proceso de backup. El target HTTP (`runtime`, mas abajo)
# NUNCA instala este paquete: la superficie de ambos targets se mantiene
# deliberadamente separada. Version de postgresql18-client sin fijar a
# proposito (solo el major 18 se valida) para permitir parches dentro de
# la rama Alpine 3.24 ya pinneada por la imagen base.
FROM app AS backup
USER root
RUN apk add --no-cache postgresql18-client
USER node

# Target HTTP por defecto (sin --target, `docker build` construye esta
# etapa por ser la ultima del archivo — se mantiene asi deliberadamente
# para no cambiar el contrato de build implicito existente).
FROM app AS runtime
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "backend/api/server.js"]
