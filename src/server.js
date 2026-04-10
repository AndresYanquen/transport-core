const http = require("http");

const app = require("./app");
const { env } = require("./config");
const { initializeSocketServer } = require("./realtime/socket.server");

const server = http.createServer(app);
initializeSocketServer(server);

server.listen(env.port, () => {
  console.log(`Server listening on port ${env.port} (${env.nodeEnv})`);
});
