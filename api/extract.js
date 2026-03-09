const { extractFromUrl } = require("../lib/extract-product");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (!body.url) {
      res.status(400).json({ error: "URL_REQUIRED" });
      return;
    }

    const product = await extractFromUrl(body.url);
    res.status(200).json({ product });
  } catch (error) {
    res.status(500).json({
      error: "EXTRACT_ERROR",
      message: error.message,
    });
  }
};
