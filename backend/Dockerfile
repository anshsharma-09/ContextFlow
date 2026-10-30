FROM node:24-alpine
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend ./
COPY database /app/database
RUN mkdir -p logs && chown -R node:node /app
USER node
EXPOSE 5000
CMD ["sh", "-c", "npm run db:setup && npm start"]
