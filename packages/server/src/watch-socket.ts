import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import { WatchSession, type RoomLinkFactory, type WatchTransport } from "./watch.js";

export const WATCH_SOCKET_PATH = "/v1/watch/socket";
/** Largest binary frame accepted from a watch (about 4 s of 16 kHz audio). */
const MAX_AUDIO_FRAME = 128 * 1024;
/** Drop a socket that has sent nothing for this long (the watch streams audio, so silence means gone). */
const IDLE_MS = 60_000;

export interface WatchSocketDeps {
  secret: string;
  connect: RoomLinkFactory;
  agentName: (roomId: string) => Promise<string>;
  idleMs?: number;
}

/** Attach the watch WebSocket to an http server. Only `WATCH_SOCKET_PATH` is upgraded. */
export function attachWatchSocket(server: Server, deps: WatchSocketDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_AUDIO_FRAME });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== WATCH_SOCKET_PATH) {
      // Nothing else upgrades on this server: refuse instead of leaving the socket hanging.
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => serve(ws, deps));
  });
  return wss;
}

function serve(ws: WebSocket, deps: WatchSocketDeps): void {
  const transport: WatchTransport = {
    sendText: (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg)),
    sendAudio: (pcm) => ws.readyState === ws.OPEN && ws.send(pcm, { binary: true }),
    close: () => ws.close(),
  };
  const session = new WatchSession(transport, deps.secret, deps.connect, deps.agentName);
  const idleMs = deps.idleMs ?? IDLE_MS;
  let timer = setTimeout(() => ws.terminate(), idleMs);
  // Frames are handled in order, one at a time, so `start` finishes before the first audio.
  let chain: Promise<void> = Promise.resolve();
  ws.on("message", (data: RawData, isBinary: boolean) => {
    clearTimeout(timer);
    timer = setTimeout(() => ws.terminate(), idleMs);
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
    chain = chain.then(async () => {
      if (isBinary) session.onAudio(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      else await session.onText(buf.toString("utf8"));
    });
  });
  ws.on("close", () => {
    clearTimeout(timer);
    chain = chain.then(() => session.onClose());
  });
  ws.on("error", () => ws.terminate());
}
