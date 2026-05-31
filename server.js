// Render-hosted feedback backend for the UX Writing Agent Figma plugin.
//
// Routes:
//   POST /api/feedback              — append a new event (called by the plugin)
//   GET  /api/feedback?token=…      — list events (called by the dashboard)
//   GET  /api/feedback/image/:id?token=…  — decode one event's screenshot
//   GET  /feedback                  — the static dashboard HTML
//
// Storage: Render's free Postgres database (table auto-created on first boot).
// Render auto-injects DATABASE_URL when the database is linked to the service.
// Set FEEDBACK_READ_TOKEN to any long random string so only Michael can read.

const express = require("express");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const READ_TOKEN = process.env.FEEDBACK_READ_TOKEN || "";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render's managed Postgres uses self-signed certs in some regions.
  ssl: { rejectUnauthorized: false },
  max: 5,
});

// One-time table creation. Runs on every boot but the IF NOT EXISTS guards
// make it cheap and idempotent. JSONB column stores the full original payload
// for forward-compatibility — if we add new event fields in the plugin, they
// land in raw_payload even if we forget to add a column for them here.
async function ensureSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        event_type TEXT,
        rating TEXT,
        comment TEXT,
        score INTEGER,
        run_type TEXT,
        screens_reviewed INTEGER,
        findings_count INTEGER,
        finding_id TEXT,
        layer_id TEXT,
        layer_name TEXT,
        screen_name TEXT,
        category TEXT,
        summary TEXT,
        scope TEXT,
        image_base64 TEXT,
        raw_payload JSONB
      );
    `);
    // Migrations for fields added after the table was first created. ADD COLUMN
    // IF NOT EXISTS is idempotent — safe to run on every boot.
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS layer_box JSONB;`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS current_text TEXT;`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS suggestion TEXT;`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS rule_id TEXT;`);
    // user_name + user_id: pulled from figma.currentUser on the plugin side
    // and sent with every event. Lets the dashboard attribute and filter by PM.
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS user_name TEXT;`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS user_id TEXT;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_received_at ON events (received_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_user_id ON events (user_id);`);
    console.log("[db] schema ready");
  } catch (err) {
    console.error("[db] schema init failed:", err.message);
  }
}
ensureSchema();

// CORS — the plugin POSTs from a Figma sandbox iframe so we need permissive
// headers. The POST endpoint is unauthenticated by design (the plugin can't
// safely carry a secret). Read endpoints are token-gated.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Body parsers — the plugin sends text/plain (no-cors restriction) so we
// accept both that and application/json.
app.use(express.json({ limit: "5mb" }));
app.use(express.text({ type: "text/*", limit: "5mb" }));

app.post("/api/feedback", async (req, res) => {
  let body = req.body;
  if (typeof body === "string") {
    try { body = body ? JSON.parse(body) : {}; }
    catch (_) { return res.status(400).json({ ok: false, error: "invalid JSON" }); }
  }
  if (!body || typeof body !== "object") body = {};
  const id = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  try {
    await pool.query(
      `INSERT INTO events
        (id, event_type, rating, comment, score, run_type, screens_reviewed,
         findings_count, finding_id, layer_id, layer_name, screen_name,
         category, summary, scope, image_base64, layer_box, current_text,
         suggestion, rule_id, user_name, user_id, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        id,
        body.eventType || null,
        body.rating || null,
        body.comment || null,
        typeof body.score === "number" ? body.score : null,
        body.runType || null,
        typeof body.screensReviewed === "number" ? body.screensReviewed : null,
        typeof body.findingsCount === "number" ? body.findingsCount : null,
        body.findingId || null,
        body.layerId || null,
        body.layerName || null,
        body.screenName || null,
        body.category || null,
        body.summary || null,
        body.scope || null,
        body.imageBase64 || null,
        body.layerBox || null,
        body.currentText || null,
        body.suggestion || null,
        body.ruleId || null,
        body.userName || null,
        body.userId || null,
        body,
      ]
    );
    res.status(200).json({ ok: true, id });
  } catch (err) {
    console.error("[db] insert failed:", err.message);
    res.status(500).json({ ok: false, error: "db write failed" });
  }
});

app.get("/api/feedback", async (req, res) => {
  if (!READ_TOKEN || req.query.token !== READ_TOKEN) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const limit = Math.min(parseInt(req.query.limit || "500", 10) || 500, 1000);
  try {
    const result = await pool.query(
      `SELECT id, received_at, event_type, rating, comment, score, run_type,
              screens_reviewed, findings_count, finding_id, layer_id,
              layer_name, screen_name, category, summary, scope,
              current_text, suggestion, rule_id, layer_box,
              user_name, user_id,
              (image_base64 IS NOT NULL) AS has_image
         FROM events
         ORDER BY received_at DESC
         LIMIT $1`,
      [limit]
    );
    const events = result.rows.map((r) => ({
      id: r.id,
      receivedAt: r.received_at && r.received_at.toISOString(),
      eventType: r.event_type,
      rating: r.rating,
      comment: r.comment,
      score: r.score,
      runType: r.run_type,
      screensReviewed: r.screens_reviewed,
      findingsCount: r.findings_count,
      findingId: r.finding_id,
      layerId: r.layer_id,
      layerName: r.layer_name,
      screenName: r.screen_name,
      category: r.category,
      summary: r.summary,
      scope: r.scope,
      currentText: r.current_text,
      suggestion: r.suggestion,
      ruleId: r.rule_id,
      layerBox: r.layer_box,
      userName: r.user_name,
      userId: r.user_id,
      hasImage: r.has_image,
    }));
    res.status(200).json({ ok: true, count: events.length, events });
  } catch (err) {
    console.error("[db] query failed:", err.message);
    res.status(500).json({ ok: false, error: "db query failed" });
  }
});

// DELETE every event in the table. Token-gated. Used by the dashboard's
// "Clear all" button to wipe test data before the real pilot starts.
app.delete("/api/feedback", async (req, res) => {
  if (!READ_TOKEN || req.query.token !== READ_TOKEN) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  try {
    const result = await pool.query("DELETE FROM events");
    res.status(200).json({ ok: true, deleted: result.rowCount });
  } catch (err) {
    console.error("[db] delete failed:", err.message);
    res.status(500).json({ ok: false, error: "db delete failed" });
  }
});

app.get("/api/feedback/image/:id", async (req, res) => {
  if (!READ_TOKEN || req.query.token !== READ_TOKEN) {
    return res.status(403).send("forbidden");
  }
  try {
    const result = await pool.query(
      `SELECT image_base64 FROM events WHERE id = $1`,
      [req.params.id]
    );
    const row = result.rows[0];
    if (!row || !row.image_base64) return res.status(404).send("not found");
    const buf = Buffer.from(row.image_base64, "base64");
    res.setHeader("content-type", "image/png");
    res.setHeader("cache-control", "private, max-age=3600");
    res.status(200).send(buf);
  } catch (err) {
    res.status(500).send("db query failed");
  }
});

// Static dashboard. Express serves anything in public/ at the root. The
// explicit redirect ensures /feedback (no trailing slash) goes to
// /feedback/ which express.static then serves from index.html.
app.use(express.static(path.join(__dirname, "public")));
app.get("/feedback", (req, res) => {
  res.redirect(301, "/feedback/");
});

app.get("/", (req, res) => {
  res.type("text/plain").send("UX Writing Agent feedback backend. Dashboard at /feedback.");
});

app.listen(PORT, () => {
  console.log("[server] listening on " + PORT);
});
