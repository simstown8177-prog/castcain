const { getSharedState, saveSharedState } = require("../lib/state-store");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === "GET") {
      const state = await getSharedState();
      res.status(200).json({ state });
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const state = await saveSharedState(body.state);
      res.status(200).json({ state });
      return;
    }

    res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    res.status(500).json({
      error: "STATE_ERROR",
      message: error.message,
    });
  }
};
