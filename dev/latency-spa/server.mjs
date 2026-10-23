// Zero-dependency test server: static SPA, /api/ping for round trips,
// /api/echo for POST payloads, /api/events for server-sent events.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const port = Number(process.env.PORT ?? 5180);
const host = process.env.HOST ?? "127.0.0.1";
const indexUrl = new URL("./index.html", import.meta.url);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/api/ping") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ t: Date.now() }));
    return;
  }
  if (url.pathname === "/api/echo" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
    res.end(Buffer.concat(chunks));
    return;
  }
  if (url.pathname === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    let seq = 0;
    const timer = setInterval(() => res.write(`data: ${JSON.stringify({ seq: seq++, t: Date.now() })}\n\n`), 250);
    req.on("close", () => clearInterval(timer));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(await readFile(indexUrl));
}).listen(port, host, () => console.log(`http://${host}:${port}`));
