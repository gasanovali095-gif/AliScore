const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");
const webpush = require("web-push");

const app = express();

/* =========================
   SETTINGS
========================= */

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

const PORT = process.env.PORT || 10000;

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:aliscore@example.com";

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =========================
   WEB PUSH
========================= */

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      VAPID_SUBJECT,
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );

    console.log("Web Push configured");
  } catch (error) {
    console.error("WEB PUSH CONFIG ERROR:", error);
  }
} else {
  console.warn(
    "Web Push is not configured. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY missing."
  );
}

/* =========================
   DATABASE
========================= */

async function initDatabase() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      points INTEGER DEFAULT 0,
      played INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      goal_difference INTEGER DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      match_date TEXT,
      home_team_id INTEGER,
      away_team_id INTEGER,
      home_score INTEGER DEFAULT 0,
      away_score INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      number INTEGER DEFAULT 0,
      position TEXT DEFAULT '',
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS goals INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS assists INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS saves INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rating INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS photo TEXT DEFAULT ''
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_of_week (
      id SERIAL PRIMARY KEY,
      week_start DATE NOT NULL,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      position TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  /* =========================
     PUSH SUBSCRIPTIONS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /* =========================
     SEED TEAMS
  ========================= */

  const count = await pool.query(
    "SELECT COUNT(*)::int AS count FROM teams"
  );

  if (count.rows[0].count === 0) {

    const teams = [
      "Lotu pişiklər",
      "MSN FK",
      "Neweli FK",
      "Xirdalan United",
      "Xirdalan Wolves"
    ];

    for (const name of teams) {

      await pool.query(
        `INSERT INTO teams
        (name, points, played, wins, draws, losses, goal_difference)
        VALUES ($1,0,0,0,0,0,0)`,
        [name]
      );

    }
  }

  /* =========================
     SEED PLAYERS
  ========================= */

  const playersCount = await pool.query(
    "SELECT COUNT(*)::int AS count FROM players"
  );

  if (playersCount.rows[0].count === 0) {

    const teams = await pool.query(
      "SELECT id, name FROM teams"
    );

    const ids = {};

    for (const team of teams.rows) {
      ids[team.name] = team.id;
    }

    const players = [
      ["Kamran", "Lotu pişiklər"],
      ["Minə", "Lotu pişiklər"],
      ["Ramil", "Lotu pişiklər"],
      ["Huseyin", "Lotu pişiklər"],

      ["Fuad", "MSN FK"],
      ["Murad", "MSN FK"],
      ["Ayxan", "MSN FK"],
      ["Şahin", "MSN FK"],

      ["Tofik", "Neweli FK"],
      ["Arda", "Neweli FK"],
      ["Veli", "Neweli FK"],
      ["Emil", "Neweli FK"],

      ["Amil", "Xirdalan United"],
      ["Elmir", "Xirdalan United"],
      ["İsa", "Xirdalan United"],
      ["Ümüd", "Xirdalan United"],

      ["Ali", "Xirdalan Wolves"],
      ["Emin", "Xirdalan Wolves"],
      ["Huseyin (2 blok)", "Xirdalan Wolves"],
      ["Raul", "Xirdalan Wolves"]
    ];

    for (const player of players) {

      await pool.query(
        `INSERT INTO players
        (name, number, position, team_id, goals, assists, saves, rating, photo)
        VALUES ($1,0,'',$2,0,0,0,0,'')`,
        [
          player[0],
          ids[player[1]]
        ]
      );

    }
  }

  console.log("Database initialized");
}

/* =========================
   SEND PUSH NOTIFICATION
========================= */

async function sendPushNotification(payload) {

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log("Push skipped: VAPID keys are missing.");
    return;
  }

  try {

    const result = await pool.query(`
      SELECT
        id,
        endpoint,
        p256dh,
        auth
      FROM push_subscriptions
    `);

    if (!result.rows.length) {
      console.log("Push skipped: no subscribers.");
      return;
    }

    await Promise.all(
      result.rows.map(async (subscriptionRow) => {

        const subscription = {
          endpoint: subscriptionRow.endpoint,
          keys: {
            p256dh: subscriptionRow.p256dh,
            auth: subscriptionRow.auth
          }
        };

        try {

          await webpush.sendNotification(
            subscription,
            JSON.stringify(payload),
            {
              TTL: 60,
              urgency: "high"
            }
          );

          console.log(
            "Push sent:",
            subscriptionRow.endpoint.substring(0, 50)
          );

        } catch (error) {

          console.error(
            "PUSH SEND ERROR:",
            error.statusCode,
            error.message
          );

          /*
             404 and 410 mean that the subscription
             is no longer valid.
          */

          if (
            error.statusCode === 404 ||
            error.statusCode === 410
          ) {

            await pool.query(
              "DELETE FROM push_subscriptions WHERE id=$1",
              [subscriptionRow.id]
            );

            console.log(
              "Removed expired push subscription:",
              subscriptionRow.id
            );
          }

        }

      })
    );

  } catch (error) {

    console.error(
      "PUSH NOTIFICATION ERROR:",
      error
    );

  }

}

/* =========================
   PUSH PUBLIC KEY
========================= */

app.get("/api/push/public-key", (req, res) => {

  if (!VAPID_PUBLIC_KEY) {

    return res.status(503).json({
      error: "Push notifications are not configured"
    });

  }

  res.json({
    publicKey: VAPID_PUBLIC_KEY
  });

});

/* =========================
   SAVE PUSH SUBSCRIPTION
========================= */

app.post("/api/push/subscribe", async (req, res) => {

  try {

    const subscription = req.body;

    if (
      !subscription ||
      !subscription.endpoint ||
      !subscription.keys ||
      !subscription.keys.p256dh ||
      !subscription.keys.auth
    ) {

      return res.status(400).json({
        error: "Invalid push subscription"
      });

    }

    await pool.query(
      `
        INSERT INTO push_subscriptions
        (
          endpoint,
          p256dh,
          auth
        )
        VALUES ($1,$2,$3)
        ON CONFLICT(endpoint)
        DO UPDATE SET
          p256dh=EXCLUDED.p256dh,
          auth=EXCLUDED.auth
      `,
      [
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth
      ]
    );

    res.json({
      ok: true
    });

  } catch (error) {

    console.error(
      "PUSH SUBSCRIBE ERROR:",
      error
    );

    res.status(500).json({
      error: "Could not save push subscription"
    });

  }

});

/* =========================
   REMOVE PUSH SUBSCRIPTION
========================= */

app.delete("/api/push/subscribe", async (req, res) => {

  try {

    const endpoint =
      String(req.body?.endpoint || "").trim();

    if (!endpoint) {

      return res.status(400).json({
        error: "Endpoint is required"
      });

    }

    await pool.query(
      "DELETE FROM push_subscriptions WHERE endpoint=$1",
      [endpoint]
    );

    res.json({
      ok: true
    });

  } catch (error) {

    console.error(
      "PUSH UNSUBSCRIBE ERROR:",
      error
    );

    res.status(500).json({
      error: "Could not remove push subscription"
    });

  }

});

/* =========================
   ADMIN AUTH
========================= */

function requireAdmin(req, res, next) {

  try {

    const token = req.cookies.aliscore_admin;

    if (!token) {

      return res.status(401).json({
        error: "Unauthorized"
      });

    }

    jwt.verify(token, JWT_SECRET);

    next();

  } catch {

    res.status(401).json({
      error: "Unauthorized"
    });

  }

}

/* =========================
   ADMIN LOGIN
========================= */

app.post("/api/admin/login", (req, res) => {

  if (req.body.password !== ADMIN_PASSWORD) {

    return res.status(401).json({
      error: "Wrong password"
    });

  }

  const token = jwt.sign(
    { admin: true },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.cookie("aliscore_admin", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.json({
    ok: true
  });

});

/* =========================
   ADMIN ME
========================= */

app.get("/api/admin/me", (req, res) => {

  try {

    jwt.verify(
      req.cookies.aliscore_admin,
      JWT_SECRET
    );

    res.json({
      ok: true
    });

  } catch {

    res.status(401).json({
      error: "Not logged in"
    });

  }

});

/* =========================
   ADMIN LOGOUT
========================= */

app.post("/api/admin/logout", (req, res) => {

  res.clearCookie("aliscore_admin");

  res.json({
    ok: true
  });

});

/* =========================
   TEAMS
========================= */

app.get("/api/teams", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT * FROM teams
      ORDER BY
        points DESC,
        goal_difference DESC,
        wins DESC,
        losses ASC,
        id ASC
    `);

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not load teams"
    });

  }

});

app.post("/api/teams", requireAdmin, async (req, res) => {

  try {

    const {
      name,
      points = 0,
      played = 0,
      wins = 0,
      draws = 0,
      losses = 0,
      goal_difference = 0
    } = req.body;

    const result = await pool.query(
      `INSERT INTO teams
      (name,points,played,wins,draws,losses,goal_difference)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
      [
        name,
        Number(points) || 0,
        Number(played) || 0,
        Number(wins) || 0,
        Number(draws) || 0,
        Number(losses) || 0,
        Number(goal_difference) || 0
      ]
    );

    res.json(result.rows[0]);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not create team"
    });

  }

});

app.put("/api/teams/:id", requireAdmin, async (req, res) => {

  try {

    const {
      name,
      points = 0,
      played = 0,
      wins = 0,
      draws = 0,
      losses = 0,
      goal_difference = 0
    } = req.body;

    const result = await pool.query(
      `UPDATE teams SET
        name=$1,
        points=$2,
        played=$3,
        wins=$4,
        draws=$5,
        losses=$6,
        goal_difference=$7
      WHERE id=$8
      RETURNING *`,
      [
        name,
        Number(points) || 0,
        Number(played) || 0,
        Number(wins) || 0,
        Number(draws) || 0,
        Number(losses) || 0,
        Number(goal_difference) || 0,
        Number(req.params.id)
      ]
    );

    if (!result.rows.length) {

      return res.status(404).json({
        error: "Team not found"
      });

    }

    res.json(result.rows[0]);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not update team"
    });

  }

});

app.delete("/api/teams/:id", requireAdmin, async (req, res) => {

  try {

    await pool.query(
      "DELETE FROM teams WHERE id=$1",
      [Number(req.params.id)]
    );

    res.json({
      ok: true
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not delete team"
    });

  }

});

/* =========================
   PLAYERS
========================= */

app.get("/api/players", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT
        players.id,
        players.name,
        players.number,
        players.position,
        players.team_id,
        COALESCE(players.goals,0) AS goals,
        COALESCE(players.assists,0) AS assists,
        COALESCE(players.saves,0) AS saves,
        COALESCE(players.rating,0) AS rating,
        COALESCE(players.photo,'') AS photo,
        teams.name AS team_name
      FROM players
      JOIN teams ON teams.id = players.team_id
      ORDER BY players.team_id, players.id
    `);

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not load players"
    });

  }

});

/* =========================
   PLAYERS BY TEAM
========================= */

app.get("/api/teams/:id/players", async (req, res) => {

  try {

    const result = await pool.query(
      `SELECT
        id,
        name,
        number,
        position,
        team_id,
        COALESCE(goals,0) AS goals,
        COALESCE(assists,0) AS assists,
        COALESCE(saves,0) AS saves,
        COALESCE(rating,0) AS rating,
        COALESCE(photo,'') AS photo
       FROM players
       WHERE team_id=$1
       ORDER BY id`,
      [Number(req.params.id)]
    );

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not load team players"
    });

  }

});

/* =========================
   ADD PLAYER
========================= */

app.post("/api/players", requireAdmin, async (req, res) => {

  try {

    const {
      name,
      number = 0,
      position = "",
      team_id,
      goals = 0,
      assists = 0,
      saves = 0,
      rating = 0,
      photo = ""
    } = req.body;

    const safeRating = Math.max(
      0,
      Math.min(100, Number(rating) || 0)
    );

    const safePhoto = String(photo || "");

    if (
      safePhoto &&
      !safePhoto.startsWith("data:image/")
    ) {

      return res.status(400).json({
        error: "Invalid image"
      });

    }

    if (
      safePhoto.length >
      8 * 1024 * 1024
    ) {

      return res.status(400).json({
        error: "Image is too large"
      });

    }

    const result = await pool.query(
      `INSERT INTO players
      (
        name,
        number,
        position,
        team_id,
        goals,
        assists,
        saves,
        rating,
        photo
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        name,
        Number(number) || 0,
        position,
        Number(team_id),
        Number(goals) || 0,
        Number(assists) || 0,
        Number(saves) || 0,
        safeRating,
        safePhoto
      ]
    );

    res.json(result.rows[0]);

  } catch (error) {

    console.error("ADD PLAYER ERROR:", error);

    res.status(500).json({
      error: "Could not create player"
    });

  }

});

/* =========================
   UPDATE PLAYER
========================= */

app.put("/api/players/:id", requireAdmin, async (req, res) => {

  try {

    const {
      name,
      number = 0,
      position = "",
      team_id,
      goals = 0,
      assists = 0,
      saves = 0,
      rating = 0
    } = req.body;

    const safeRating = Math.max(
      0,
      Math.min(100, Number(rating) || 0)
    );

    const result = await pool.query(
      `UPDATE players SET
        name=$1,
        number=$2,
        position=$3,
        team_id=$4,
        goals=$5,
        assists=$6,
        saves=$7,
        rating=$8
      WHERE id=$9
      RETURNING *`,
      [
        name,
        Number(number) || 0,
        position,
        Number(team_id),
        Number(goals) || 0,
        Number(assists) || 0,
        Number(saves) || 0,
        safeRating,
        Number(req.params.id)
      ]
    );

    if (!result.rows.length) {

      return res.status(404).json({
        error: "Player not found"
      });

    }

    res.json(result.rows[0]);

  } catch (error) {

    console.error("UPDATE PLAYER ERROR:", error);

    res.status(500).json({
      error: "Could not update player"
    });

  }

});

/* =========================
   ADD ONE GOAL TO PLAYER
========================= */

app.post(
  "/api/players/:id/goal",
  requireAdmin,
  async (req, res) => {

    try {

      const playerId = Number(req.params.id);

      if (!Number.isInteger(playerId) || playerId <= 0) {

        return res.status(400).json({
          error: "Invalid player id"
        });

      }

      const result = await pool.query(
        `UPDATE players
         SET goals = COALESCE(goals,0) + 1
         WHERE id=$1
         RETURNING
           id,
           name,
           number,
           position,
           team_id,
           COALESCE(goals,0) AS goals,
           COALESCE(assists,0) AS assists,
           COALESCE(saves,0) AS saves,
           COALESCE(rating,0) AS rating,
           COALESCE(photo,'') AS photo`,
        [playerId]
      );

      if (!result.rows.length) {

        return res.status(404).json({
          error: "Player not found"
        });

      }

      const player = result.rows[0];

      /* =========================
         GET TEAM NAME
      ========================= */

      const teamResult = await pool.query(
        `SELECT name
         FROM teams
         WHERE id=$1`,
        [player.team_id]
      );

      const teamName =
        teamResult.rows.length
          ? teamResult.rows[0].name
          : "";

      /* =========================
         SEND PUSH
      ========================= */

      sendPushNotification({
        title: "⚽ AliScore",
        body: teamName
          ? `${player.name} (${teamName}) qol vurdu!`
          : `${player.name} qol vurdu!`,
        url: "/"
      }).catch(error => {
        console.error(
          "PUSH GOAL ERROR:",
          error
        );
      });

      res.json({
        ok: true,
        player
      });

    } catch (error) {

      console.error("ADD GOAL ERROR:", error);

      res.status(500).json({
        error: "Could not add goal"
      });

    }

  }
);

/* =========================
   REMOVE ONE GOAL FROM PLAYER
========================= */

app.delete(
  "/api/players/:id/goal",
  requireAdmin,
  async (req, res) => {

    try {

      const playerId = Number(req.params.id);

      if (!Number.isInteger(playerId) || playerId <= 0) {

        return res.status(400).json({
          error: "Invalid player id"
        });

      }

      const result = await pool.query(
        `UPDATE players
         SET goals = GREATEST(COALESCE(goals,0) - 1, 0)
         WHERE id=$1
         RETURNING
           id,
           name,
           number,
           position,
           team_id,
           COALESCE(goals,0) AS goals,
           COALESCE(assists,0) AS assists,
           COALESCE(saves,0) AS saves,
           COALESCE(rating,0) AS rating,
           COALESCE(photo,'') AS photo`,
        [playerId]
      );

      if (!result.rows.length) {

        return res.status(404).json({
          error: "Player not found"
        });

      }

      res.json({
        ok: true,
        player: result.rows[0]
      });

    } catch (error) {

      console.error("REMOVE GOAL ERROR:", error);

      res.status(500).json({
        error: "Could not remove goal"
      });

    }

  }
);

/* =========================
   PLAYER PHOTO
========================= */

app.put(
  "/api/players/:id/photo",
  requireAdmin,
  async (req, res) => {

    try {

      const photo = String(
        req.body?.photo || ""
      );

      if (
        photo &&
        !photo.startsWith("data:image/")
      ) {

        return res.status(400).json({
          error: "Invalid image"
        });

      }

      if (
        photo.length >
        8 * 1024 * 1024
      ) {

        return res.status(400).json({
          error: "Image is too large"
        });

      }

      const result = await pool.query(
        `UPDATE players
         SET photo=$1
         WHERE id=$2
         RETURNING *`,
        [
          photo,
          Number(req.params.id)
        ]
      );

      if (!result.rowCount) {

        return res.status(404).json({
          error: "Player not found"
        });

      }

      res.json(result.rows[0]);

    } catch (error) {

      console.error(
        "PHOTO ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not update player photo"
      });

    }

  }
);

/* =========================
   PLAYER RATING
========================= */

app.put(
  "/api/players/:id/rating",
  requireAdmin,
  async (req, res) => {

    try {

      const rating = Math.max(
        0,
        Math.min(
          100,
          Number(req.body?.rating) || 0
        )
      );

      const result = await pool.query(
        `UPDATE players
         SET rating=$1
         WHERE id=$2
         RETURNING *`,
        [
          rating,
          Number(req.params.id)
        ]
      );

      if (!result.rowCount) {

        return res.status(404).json({
          error: "Player not found"
        });

      }

      res.json(result.rows[0]);

    } catch (error) {

      console.error(
        "RATING ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not update player rating"
      });

    }

  }
);

/* =========================
   DELETE PLAYER
========================= */

app.delete("/api/players/:id", requireAdmin, async (req, res) => {

  try {

    await pool.query(
      "DELETE FROM players WHERE id=$1",
      [Number(req.params.id)]
    );

    res.json({
      ok: true
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not delete player"
    });

  }

});

/* =========================
   PLAYER STATISTICS
========================= */

app.get("/api/statistics", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT
        players.id,
        players.name,
        players.number,
        players.position,
        players.team_id,
        teams.name AS team_name,
        COALESCE(players.goals,0) AS goals,
        COALESCE(players.assists,0) AS assists,
        COALESCE(players.saves,0) AS saves,
        COALESCE(players.rating,0) AS rating,
        COALESCE(players.photo,'') AS photo
      FROM players
      JOIN teams ON teams.id = players.team_id
      ORDER BY
        players.goals DESC,
        players.assists DESC,
        players.id ASC
    `);

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not load statistics"
    });

  }

});

/* =========================
   UPDATE PLAYER STATS
========================= */

app.put(
  "/api/players/:id/stats",
  requireAdmin,
  async (req, res) => {

    try {

      const {
        goals = 0,
        assists = 0,
        saves = 0
      } = req.body;

      const safeGoals = Math.max(
        0,
        Number(goals) || 0
      );

      const safeAssists = Math.max(
        0,
        Number(assists) || 0
      );

      const safeSaves = Math.max(
        0,
        Number(saves) || 0
      );

      const result = await pool.query(
        `UPDATE players SET
          goals=$1,
          assists=$2,
          saves=$3
        WHERE id=$4
        RETURNING *`,
        [
          safeGoals,
          safeAssists,
          safeSaves,
          Number(req.params.id)
        ]
      );

      if (!result.rows.length) {

        return res.status(404).json({
          error: "Player not found"
        });

      }

      res.json(result.rows[0]);

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Could not update statistics"
      });

    }

  }
);

/* =========================
   POSITION NORMALIZATION
========================= */

function normalizePosition(position) {

  return String(position || "")
    .trim()
    .toLowerCase()
    .replaceAll("ə", "e")
    .replaceAll("ı", "i")
    .replaceAll("ö", "o")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ç", "c")
    .replaceAll("ğ", "g");

}

function getPositionGroup(position) {

  const p = normalizePosition(position);

  if (
    p.includes("qapici") ||
    p.includes("goalkeeper") ||
    p === "gk" ||
    p === "keeper"
  ) {

    return "Qapıçı";

  }

  if (
    p.includes("mudafie") ||
    p.includes("defender") ||
    p.includes("defence") ||
    p === "df" ||
    p === "cb" ||
    p === "lb" ||
    p === "rb"
  ) {

    return "Müdafiə";

  }

  if (
    p.includes("yarim") ||
    p.includes("midfield") ||
    p === "mf" ||
    p === "cm" ||
    p === "dm" ||
    p === "am"
  ) {

    return "Yarımmüdafiə";

  }

  if (
    p.includes("hucum") ||
    p.includes("forvard") ||
    p.includes("forward") ||
    p.includes("attack") ||
    p === "fw" ||
    p === "st" ||
    p === "cf"
  ) {

    return "Hücum";

  }

  return "Digər";

}

/* =========================
   TEAM OF THE WEEK
========================= */

app.get(
  "/api/team-of-week",
  async (req, res) => {

    try {

      let week = req.query.week;

      if (!week) {

        const today = new Date();

        const day = today.getUTCDay();

        const diff =
          day === 0
            ? -6
            : 1 - day;

        const monday =
          new Date(today);

        monday.setUTCDate(
          today.getUTCDate() + diff
        );

        week =
          monday
            .toISOString()
            .slice(0, 10);

      }

      const result = await pool.query(`
        SELECT
          team_of_week.id,
          team_of_week.week_start,
          team_of_week.position AS selected_position,

          players.id AS player_id,
          players.name,
          players.number,
          players.position,
          players.goals,
          players.assists,
          players.saves,
          players.rating,
          players.photo,
          players.team_id,

          teams.name AS team_name

        FROM team_of_week

        JOIN players
          ON players.id = team_of_week.player_id

        JOIN teams
          ON teams.id = players.team_id

        WHERE team_of_week.week_start=$1

        ORDER BY
          CASE
            WHEN team_of_week.position='Qapıçı' THEN 1
            WHEN team_of_week.position='Müdafiə' THEN 2
            WHEN team_of_week.position='Yarımmüdafiə' THEN 3
            WHEN team_of_week.position='Hücum' THEN 4
            ELSE 5
          END,

          team_of_week.id
      `, [week]);

      res.json({
        week_start: week,
        players: result.rows
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not load team of the week"
      });

    }

  }
);

/* =========================
   SAVE TEAM OF THE WEEK
========================= */

app.post(
  "/api/team-of-week",
  requireAdmin,
  async (req, res) => {

    try {

      const {
        week_start,
        players
      } = req.body;

      if (!week_start) {

        return res.status(400).json({
          error:
            "week_start is required"
        });

      }

      if (!Array.isArray(players)) {

        return res.status(400).json({
          error:
            "players must be an array"
        });

      }

      if (players.length !== 11) {

        return res.status(400).json({
          error:
            "Team of the Week must contain exactly 11 players"
        });

      }

      const uniquePlayers = [
        ...new Set(
          players.map(player =>
            Number(
              typeof player === "object"
                ? player.player_id
                : player
            )
          )
        )
      ];

      if (uniquePlayers.length !== 11) {

        return res.status(400).json({
          error:
            "A player cannot be selected twice"
        });

      }

      const selectedPlayers =
        await pool.query(
          `SELECT
            id,
            position
           FROM players
           WHERE id = ANY($1::int[])`,
          [uniquePlayers]
        );

      if (
        selectedPlayers.rows.length !== 11
      ) {

        return res.status(400).json({
          error:
            "One or more players do not exist"
        });

      }

      const preparedPlayers =
        players.map(player => {

          const playerId =
            Number(
              typeof player === "object"
                ? player.player_id
                : player
            );

          const dbPlayer =
            selectedPlayers.rows.find(
              p => p.id === playerId
            );

          const selectedPosition =
            typeof player === "object" &&
            player.position
              ? player.position
              : getPositionGroup(
                  dbPlayer.position
                );

          return {
            player_id: playerId,
            position: selectedPosition
          };

        });

      const goalkeeperCount =
        preparedPlayers.filter(
          player =>
            player.position === "Qapıçı"
        ).length;

      if (goalkeeperCount !== 1) {

        return res.status(400).json({
          error:
            "Team of the Week must contain exactly 1 goalkeeper"
        });

      }

      const defensiveCount =
        preparedPlayers.filter(
          player =>
            player.position === "Müdafiə"
        ).length;

      const midfieldCount =
        preparedPlayers.filter(
          player =>
            player.position === "Yarımmüdafiə"
        ).length;

      const attackCount =
        preparedPlayers.filter(
          player =>
            player.position === "Hücum"
        ).length;

      if (
        defensiveCount +
        midfieldCount +
        attackCount +
        goalkeeperCount !== 11
      ) {

        return res.status(400).json({
          error:
            "Invalid player positions"
        });

      }

      await pool.query("BEGIN");

      await pool.query(
        `DELETE FROM team_of_week
         WHERE week_start=$1`,
        [week_start]
      );

      for (const player of preparedPlayers) {

        await pool.query(
          `INSERT INTO team_of_week
          (week_start,player_id,position)
          VALUES ($1,$2,$3)`,
          [
            week_start,
            player.player_id,
            player.position
          ]
        );

      }

      await pool.query("COMMIT");

      res.json({
        ok: true,
        week_start,
        players: preparedPlayers
      });

    } catch (error) {

      try {
        await pool.query("ROLLBACK");
      } catch {}

      console.error(error);

      res.status(500).json({
        error:
          "Could not save team of the week"
      });

    }

  }
);

/* =========================
   DELETE TEAM OF THE WEEK
========================= */

app.delete(
  "/api/team-of-week/:week",
  requireAdmin,
  async (req, res) => {

    try {

      await pool.query(
        `DELETE FROM team_of_week
         WHERE week_start=$1`,
        [req.params.week]
      );

      res.json({
        ok: true
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not delete team of the week"
      });

    }

  }
);

/* =========================
   MATCHES
========================= */

app.get("/api/matches", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT * FROM matches
      ORDER BY match_date DESC, id DESC
    `);

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not load matches"
    });

  }

});

app.post("/api/matches", requireAdmin, async (req, res) => {

  try {

    const {
      match_date,
      home_team_id,
      away_team_id,
      home_score,
      away_score
    } = req.body;

    const result = await pool.query(
      `INSERT INTO matches
      (
        match_date,
        home_team_id,
        away_team_id,
        home_score,
        away_score
      )
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *`,
      [
        match_date || "",
        Number(home_team_id),
        Number(away_team_id),
        Number(home_score) || 0,
        Number(away_score) || 0
      ]
    );

    res.json(result.rows[0]);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not create match"
    });

  }

});

app.put(
  "/api/matches/:id",
  requireAdmin,
  async (req, res) => {

    try {

      const {
        match_date,
        home_team_id,
        away_team_id,
        home_score,
        away_score
      } = req.body;

      const result = await pool.query(
        `UPDATE matches SET
          match_date=$1,
          home_team_id=$2,
          away_team_id=$3,
          home_score=$4,
          away_score=$5
        WHERE id=$6
        RETURNING *`,
        [
          match_date || "",
          Number(home_team_id),
          Number(away_team_id),
          Number(home_score) || 0,
          Number(away_score) || 0,
          Number(req.params.id)
        ]
      );

      if (!result.rows.length) {

        return res.status(404).json({
          error: "Match not found"
        });

      }

      res.json(result.rows[0]);

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Could not update match"
      });

    }

  }
);

app.delete(
  "/api/matches/:id",
  requireAdmin,
  async (req, res) => {

    try {

      await pool.query(
        "DELETE FROM matches WHERE id=$1",
        [Number(req.params.id)]
      );

      res.json({
        ok: true
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Could not delete match"
      });

    }

  }
);

/* =========================
   HEALTH
========================= */

app.get("/api/health", async (req, res) => {

  try {

    await pool.query("SELECT 1");

    res.json({
      ok: true,
      database: "connected"
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      ok: false,
      database: "error"
    });

  }

});

/* =========================
   WEBSITE
========================= */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

app.get("*splat", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );

});

/* =========================
   START
========================= */

initDatabase()

  .then(() => {

    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `AliScore running on port ${PORT}`
        );

      }
    );

  })

  .catch(error => {

    console.error(error);

    process.exit(1);

  });
