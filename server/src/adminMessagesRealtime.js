"use strict";

const WebSocket = require("ws");
const WebSocketServer = WebSocket.WebSocketServer || WebSocket.Server;

/** Must match nginx-proxied path and browser URL. */
const WS_PATH = "/api/admin/messages-ws";

let wss = null;
let heartbeatTimer = null;

/**
 * @param {import("http").Server} server
 * @param {import("express").RequestHandler} sessionMiddleware same instance as app.use(session(...))
 */
function attach(server, sessionMiddleware) {
  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
    } catch (e) {
      socket.destroy();
      return;
    }

    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    const fakeRes = {
      end: Function.prototype,
      writeHead: Function.prototype,
      setHeader: Function.prototype,
      getHeader: () => {},
    };

    sessionMiddleware(req, fakeRes, () => {
      try {
        if (!req.session || !req.session.isAdmin) {
          socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
      } catch (e) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });
  });

  heartbeatTimer = setInterval(() => {
    if (!wss) return;
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  server.on("close", () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  });

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
  });
}

function broadcast(obj) {
  if (!wss) return;
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

function notifyInboxChanged() {
  broadcast({ type: "inbox_refresh" });
}

function notifySentChanged() {
  broadcast({ type: "sent_refresh" });
}

module.exports = {
  attach,
  notifyInboxChanged,
  notifySentChanged,
};
