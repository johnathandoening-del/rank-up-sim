# Rank Up! — single-container deploy: the Node room server serves BOTH the game (static files)
# and the multiplayer WebSocket, so one deploy = the whole thing at one URL.
FROM node:20-alpine
WORKDIR /app

# Install the room server's only dependency (ws) first, for better build caching.
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# Copy the game (index.html, styles.css, net.js, font, images) + the server.
COPY . .

# Cloud hosts inject the port via $PORT; the server already reads it (defaults to 8833 locally).
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/room-server.js"]
