const http = require("http");
const fs = require("fs");
const path = require("path");
const { extractFromUrl } = require("./lib/extract-product");
const { getSharedState, saveSharedState } = require("./lib/state-store");

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

function createApiResponse(res) {
  return {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      sendJson(res, this.statusCode || 200, payload);
    },
    end(payload = "") {
      res.writeHead(this.statusCode || 200);
      res.end(payload);
    },
  };
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("REQUEST_TOO_LARGE"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendFile(res, filePath, method) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
  if (method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => sendJson(res, 500, { error: "FILE_READ_ERROR" }));
  stream.pipe(res);
}

async function handleExtract(req, res) {
  try {
    const rawBody = await collectBody(req);
    req.body = JSON.parse(rawBody || "{}");
    const apiRes = createApiResponse(res);
    if (req.method !== "POST") {
      apiRes.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    if (!req.body.url) {
      apiRes.status(400).json({ error: "URL_REQUIRED" });
      return;
    }
    const product = await extractFromUrl(req.body.url);
    apiRes.status(200).json({ product });
  } catch (error) {
    sendJson(res, 500, { error: "EXTRACT_ERROR", message: error.message });
  }
}

async function handleState(req, res) {
  try {
    const apiRes = createApiResponse(res);
    if (req.method === "GET") {
      const state = await getSharedState();
      apiRes.status(200).json({ state });
      return;
    }
    if (req.method === "POST") {
      const rawBody = await collectBody(req);
      const body = JSON.parse(rawBody || "{}");
      const state = await saveSharedState(body.state);
      apiRes.status(200).json({ state });
      return;
    }
    apiRes.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    sendJson(res, 500, { error: "STATE_ERROR", message: error.message });
  }
}

function resolveStaticFile(urlPath) {
  if (urlPath === "/") {
    return path.join(ROOT_DIR, "index.html");
  }
  const normalized = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  return path.join(ROOT_DIR, normalized);
}

function routeStatic(req, res) {
  const filePath = resolveStaticFile(req.url);
  if (!filePath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { error: "FORBIDDEN" });
    return;
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendJson(res, 404, { error: "NOT_FOUND" });
      return;
    }
    sendFile(res, filePath, req.method);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }
  if (req.url === "/api/extract") {
    await handleExtract(req, res);
    return;
  }
  if (req.url === "/api/state") {
    await handleState(req, res);
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    routeStatic(req, res);
    return;
  }
  sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
});

server.listen(PORT, () => {
  console.log(`Cost dashboard running at http://localhost:${PORT}`);
});
