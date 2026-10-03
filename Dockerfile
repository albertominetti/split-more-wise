# Split More Wise - zero-dependency Node app (no npm install needed).
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=11000
COPY package.json ./
COPY server.js store.js ./
COPY public ./public
EXPOSE 11000
CMD ["node", "server.js"]
