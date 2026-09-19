const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");
const webpush = require("web-push");

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";
const JWT_SECRET = process.env.JWT_SECRET || "aliscore-secret";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:admin@aliscore.app";

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

/* =========================
   DATABASE
========================= */

async function initDatabase() {
  /* =========================
     TEAMS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      logo TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /* =========================
     MATCHES
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      home_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      away_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      home_score INTEGER NOT NULL DEFAULT 0,
      away_score INTEGER NOT NULL DEFAULT 0,
      match_date TIMESTAMPTZ,
      status TEXT DEFAULT 'scheduled',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /* =========================
     PLAYERS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      position TEXT,
      number INTEGER,
      goals INTEGER NOT NULL DEFAULT 0,
      assists INTEGER NOT NULL DEFAULT 0,
      saves INTEGER NOT NULL DEFAULT 0,
      rating NUMERIC DEFAULT 0,
      photo TEXT,
      yellow_cards INTEGER NOT NULL DEFAULT 0,
      red_cards INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS goals INTEGER NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS assists INTEGER NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS saves INTEGER NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS rating NUMERIC DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS photo TEXT
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS yellow_cards INTEGER NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS red_cards INTEGER NOT NULL DEFAULT 0
  `);

  /* =========================
     TEAM OF WEEK
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_of_week (
      id SERIAL PRIMARY KEY,
      week TEXT NOT NULL,
      goalkeeper_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
      defender_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
      midfielder_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
      attacker_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
     TRANSFERS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transfers (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      from_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      to_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      fee NUMERIC DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /* =========================
     SEED TEAMS
  ========================= */

  const teamsCount = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM teams
  `);

  if (teamsCount.rows[0].count === 0) {
    const teams = [
      "Real Madrid",
      "Barcelona",
      "Manchester City",
      "Liverpool",
      "Fenerbahçe"
    ];

    for (const team of teams) {
      await pool.query(
        `
        INSERT INTO teams (name)
        VALUES ($1)
        ON CONFLICT (name) DO NOTHING
        `,
        [team]
      );
    }
  }

  /* =========================
     SEED PLAYERS
  ========================= */

  const playersCount = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM players
  `);

  if (playersCount.rows[0].count === 0) {
    const teams = await pool.query(`
      SELECT id, name
      FROM teams
      ORDER BY id
    `);

    const teamMap = {};

    for (const team of teams.rows) {
      teamMap[team.name] = team.id;
    }

    const players = [
      ["Thibaut Courtois", teamMap["Real Madrid"], "Qapıçı", 1],
      ["Vinicius Junior", teamMap["Real Madrid"], "Hücum", 7],
      ["Jude Bellingham", teamMap["Real Madrid"], "Yarımmüdafiə", 5],
      ["Kylian Mbappe", teamMap["Real Madrid"], "Hücum", 9],

      ["Marc-Andre ter Stegen", teamMap["Barcelona"], "Qapıçı", 1],
      ["Lamine Yamal", teamMap["Barcelona"], "Hücum", 10],
      ["Pedri", teamMap["Barcelona"], "Yarımmüdafiə", 8],
      ["Raphinha", teamMap["Barcelona"], "Hücum", 11],

      ["Ederson", teamMap["Manchester City"], "Qapıçı", 31],
      ["Erling Haaland", teamMap["Manchester City"], "Hücum", 9],
      ["Phil Foden", teamMap["Manchester City"], "Yarımmüdafiə", 47],
      ["Kevin De Bruyne", teamMap["Manchester City"], "Yarımmüdafiə", 17],

      ["Alisson Becker", teamMap["Liverpool"], "Qapıçı", 1],
      ["Mohamed Salah", teamMap["Liverpool"], "Hücum", 11],
      ["Virgil van Dijk", teamMap["Liverpool"], "Müdafiə", 4],
      ["Luis Diaz", teamMap["Liverpool"], "Hücum", 7],

      ["Dominik Livakovic", teamMap["Fenerbahçe"], "Qapıçı", 40],
      ["Edin Dzeko", teamMap["Fenerbahçe"], "Hücum", 9],
      ["Fred", teamMap["Fenerbahçe"], "Yarımmüdafiə", 13],
      ["Dusan Tadic", teamMap["Fenerbahçe"], "Yarımmüdafiə", 10]
    ];

    for (const player of players) {
      await pool.query(
        `
        INSERT INTO players
        (name, team_id, position, number)
        VALUES ($1, $2, $3, $4)
        `,
        player
      );
    }
  }
}

/* =========================
   PUSH NOTIFICATION
========================= */

async function sendPushNotification(payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log("Push notifications are not configured");
    return;
  }

  const result = await pool.query(`
    SELECT id, endpoint, p256dh, auth
    FROM push_subscriptions
  `);

  for (const subscription of result.rows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth
          }
        },
        JSON.stringify(payload)
      );
    } catch (error) {
      console.error(
        "PUSH ERROR:",
        error.statusCode,
        error.message
      );

      if (
        error.statusCode === 404 ||
        error.statusCode === 410
      ) {
        await pool.query(
          `
          DELETE FROM push_subscriptions
          WHERE id=$1
          `,
          [subscription.id]
        );
      }
    }
  }
}

/* =========================
   PUSH ROUTES
========================= */

app.get("/api/push/public-key", (req, res) => {
  res.json({
    publicKey: VAPID_PUBLIC_KEY || null
  });
});

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
        error: "Invalid subscription"
      });
    }

    await pool.query(
      `
      INSERT INTO push_subscriptions
      (endpoint, p256dh, auth)
      VALUES ($1,$2,$3)
      ON CONFLICT (endpoint)
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
    console.error("SUBSCRIBE ERROR:", error);

    res.status(500).json({
      error: "Could not save subscription"
    });
  }
});

app.delete("/api/push/subscribe", async (req, res) => {
  try {
    const endpoint = req.body?.endpoint;

    if (!endpoint) {
      return res.status(400).json({
        error: "Endpoint required"
      });
    }

    await pool.query(
      `
      DELETE FROM push_subscriptions
      WHERE endpoint=$1
      `,
      [endpoint]
    );

    res.json({
      ok: true
    });
  } catch (error) {
    console.error("UNSUBSCRIBE ERROR:", error);

    res.status(500).json({
      error: "Could not remove subscription"
    });
  }
});

/* =========================
   ADMIN AUTH
========================= */

function requireAdmin(req, res, next) {
  try {
    const token = req.cookies?.admin_token;

    if (!token) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    if (!decoded || decoded.role !== "admin") {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    req.admin = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }
}

app.post("/api/admin/login", (req, res) => {
  const password = req.body?.password;

  if (
    !password ||
    password !== ADMIN_PASSWORD
  ) {
    return res.status(401).json({
      error: "Wrong password"
    });
  }

  const token = jwt.sign(
    {
      role: "admin"
    },
    JWT_SECRET,
    {
      expiresIn: "7d"
    }
  );

  res.cookie(
    "admin_token",
    token,
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  );

  res.json({
    ok: true
  });
});

app.get("/api/admin/me", (req, res) => {
  try {
    const token = req.cookies?.admin_token;

    if (!token) {
      return res.json({
        loggedIn: false
      });
    }

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    res.json({
      loggedIn: decoded?.role === "admin"
    });
  } catch {
    res.json({
      loggedIn: false
    });
  }
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie("admin_token");

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
      SELECT *
      FROM teams
      ORDER BY name ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("LOAD TEAMS ERROR:", error);

    res.status(500).json({
      error: "Could not load teams"
    });
  }
});

app.post(
  "/api/teams",
  requireAdmin,
  async (req, res) => {
    try {
      const name = String(
        req.body?.name || ""
      ).trim();

      const logo =
        req.body?.logo || null;

      if (!name) {
        return res.status(400).json({
          error: "Team name required"
        });
      }

      const result = await pool.query(
        `
        INSERT INTO teams
        (name, logo)
        VALUES ($1,$2)
        RETURNING *
        `,
        [name, logo]
      );

      res.json(result.rows[0]);
    } catch (error) {
      console.error("CREATE TEAM ERROR:", error);

      res.status(500).json({
        error: "Could not create team"
      });
    }
  }
);

app.put(
  "/api/teams/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const name = String(
        req.body?.name || ""
      ).trim();

      const logo =
        req.body?.logo ?? null;

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error: "Invalid team id"
        });
      }

      if (!name) {
        return res.status(400).json({
          error: "Team name required"
        });
      }

      const result = await pool.query(
        `
        UPDATE teams
        SET name=$1,
            logo=$2
        WHERE id=$3
        RETURNING *
        `,
        [name, logo, id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Team not found"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error("UPDATE TEAM ERROR:", error);

      res.status(500).json({
        error: "Could not update team"
      });
    }
  }
);

app.delete(
  "/api/teams/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error: "Invalid team id"
        });
      }

      await pool.query(
        `
        DELETE FROM teams
        WHERE id=$1
        `,
        [id]
      );

      res.json({
        ok: true
      });
    } catch (error) {
      console.error("DELETE TEAM ERROR:", error);

      res.status(500).json({
        error: "Could not delete team"
      });
    }
  }
);

/* =========================
   PLAYERS
========================= */

app.get("/api/players", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        players.*,
        teams.name AS team_name
      FROM players
      LEFT JOIN teams
        ON teams.id = players.team_id
      ORDER BY players.name ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("LOAD PLAYERS ERROR:", error);

    res.status(500).json({
      error: "Could not load players"
    });
  }
});

app.get(
  "/api/teams/:id/players",
  async (req, res) => {
    try {
      const teamId = Number(req.params.id);

      const result = await pool.query(
        `
        SELECT
          players.*,
          teams.name AS team_name
        FROM players
        LEFT JOIN teams
          ON teams.id=players.team_id
        WHERE players.team_id=$1
        ORDER BY players.name ASC
        `,
        [teamId]
      );

      res.json(result.rows);
    } catch (error) {
      console.error(
        "LOAD TEAM PLAYERS ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not load players"
      });
    }
  }
);

app.post(
  "/api/players",
  requireAdmin,
  async (req, res) => {
    try {
      const name = String(
        req.body?.name || ""
      ).trim();

      const teamId =
        req.body?.team_id == null
          ? null
          : Number(req.body.team_id);

      const position =
        req.body?.position || null;

      const number =
        req.body?.number == null
          ? null
          : Number(req.body.number);

      if (!name) {
        return res.status(400).json({
          error: "Player name required"
        });
      }

      const result = await pool.query(
        `
        INSERT INTO players
        (name, team_id, position, number)
        VALUES ($1,$2,$3,$4)
        RETURNING *
        `,
        [
          name,
          teamId,
          position,
          number
        ]
      );

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "CREATE PLAYER ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not create player"
      });
    }
  }
);

app.put(
  "/api/players/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      const name = String(
        req.body?.name || ""
      ).trim();

      const teamId =
        req.body?.team_id == null
          ? null
          : Number(req.body.team_id);

      const position =
        req.body?.position || null;

      const number =
        req.body?.number == null
          ? null
          : Number(req.body.number);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error: "Invalid player id"
        });
      }

      if (!name) {
        return res.status(400).json({
          error: "Player name required"
        });
      }

      const result = await pool.query(
        `
        UPDATE players
        SET name=$1,
            team_id=$2,
            position=$3,
            number=$4
        WHERE id=$5
        RETURNING *
        `,
        [
          name,
          teamId,
          position,
          number,
          id
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Player not found"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "UPDATE PLAYER ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not update player"
      });
    }
  }
);

app.delete(
  "/api/players/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error: "Invalid player id"
        });
      }

      await pool.query(
        `
        DELETE FROM players
        WHERE id=$1
        `,
        [id]
      );

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        "DELETE PLAYER ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not delete player"
      });
    }
  }
);

/* =========================
   TRANSFERS
========================= */

app.get("/api/transfers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        transfers.id,
        transfers.player_id,
        transfers.from_team_id,
        transfers.to_team_id,
        transfers.fee,
        transfers.created_at,

        players.name AS player_name,

        from_team.name AS from_team_name,
        to_team.name AS to_team_name

      FROM transfers

      JOIN players
        ON players.id = transfers.player_id

      LEFT JOIN teams AS from_team
        ON from_team.id = transfers.from_team_id

      JOIN teams AS to_team
        ON to_team.id = transfers.to_team_id

      ORDER BY
        transfers.created_at DESC,
        transfers.id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(
      "LOAD TRANSFERS ERROR:",
      error
    );

    res.status(500).json({
      error: "Could not load transfers"
    });
  }
});

app.post(
  "/api/transfers",
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const playerId =
        Number(req.body?.player_id);

      const toTeamId =
        Number(req.body?.to_team_id);

      const fee = Math.max(
        0,
        Number(req.body?.fee) || 0
      );

      if (
        !Number.isInteger(playerId) ||
        playerId <= 0 ||
        !Number.isInteger(toTeamId) ||
        toTeamId <= 0
      ) {
        return res.status(400).json({
          error: "Invalid player or team"
        });
      }

      await client.query("BEGIN");

      const playerResult =
        await client.query(
          `
          SELECT
            players.id,
            players.name,
            players.team_id,
            current_team.name AS current_team_name

          FROM players

          JOIN teams AS current_team
            ON current_team.id=players.team_id

          WHERE players.id=$1

          FOR UPDATE
          `,
          [playerId]
        );

      if (!playerResult.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "Player not found"
        });
      }

      const player =
        playerResult.rows[0];

      if (player.team_id === toTeamId) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          error: "Player is already in this team"
        });
      }

      const toTeamResult =
        await client.query(
          `
          SELECT id, name
          FROM teams
          WHERE id=$1
          `,
          [toTeamId]
        );

      if (!toTeamResult.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "New team not found"
        });
      }

      const newTeam =
        toTeamResult.rows[0];

      const transferResult =
        await client.query(
          `
          INSERT INTO transfers
          (
            player_id,
            from_team_id,
            to_team_id,
            fee
          )
          VALUES ($1,$2,$3,$4)

          RETURNING
            id,
            player_id,
            from_team_id,
            to_team_id,
            fee,
            created_at
          `,
          [
            playerId,
            player.team_id,
            toTeamId,
            fee
          ]
        );

      await client.query(
        `
        UPDATE players
        SET team_id=$1
        WHERE id=$2
        `,
        [
          toTeamId,
          playerId
        ]
      );

      await client.query("COMMIT");

      const transfer =
        transferResult.rows[0];

      sendPushNotification({
        title: "🔄 AliScore — Yeni transfer",
        body:
          `${player.name} → ${newTeam.name}. ` +
          `${player.current_team_name} → ${newTeam.name}` +
          (fee > 0
            ? ` • ${fee}`
            : ""),
        url: "/"
      }).catch(error => {
        console.error(
          "PUSH TRANSFER ERROR:",
          error
        );
      });

      res.json({
        ok: true,

        transfer: {
          ...transfer,
          player_name: player.name,
          from_team_name:
            player.current_team_name,
          to_team_name:
            newTeam.name
        }
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "CREATE TRANSFER ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not create transfer"
      });
    } finally {
      client.release();
    }
  }
);

/* =========================
   GOALS
========================= */

app.post(
  "/api/players/:id/goal",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      const result = await pool.query(
        `
        UPDATE players
        SET goals=goals+1
        WHERE id=$1
        RETURNING *
        `,
        [id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Player not found"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "ADD GOAL ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not add goal"
      });
    }
  }
);

app.delete(
  "/api/players/:id/goal",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      const result = await pool.query(
        `
        UPDATE players
        SET goals=GREATEST(goals-1,0)
        WHERE id=$1
        RETURNING *
        `,
        [id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Player not found"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "REMOVE GOAL ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not remove goal"
      });
    }
  }
);

/* =========================
   YELLOW CARDS
========================= */

app.post(
  "/api/players/:id/yellow-card",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      const result = await pool.query(
        `
        UPDATE players
        SET yellow_cards=yellow_cards+1
        WHERE id=$1
        RETURNING *
        `,
        [id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Player not found"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "ADD YELLOW CARD ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not add yellow card"
      });
    }
  }
);

app.delete(
  "/api/players/:id/yellow-card",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      const result = await pool.query(
        `
        UPDATE players
        SET yellow_cards=GREATEST(yellow_cards-1,0)
        WHERE id=$1
        RETURNING *
        `,
        [id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Player not found"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "REMOVE YELLOW CARD ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not remove yellow card"
      });
    }
  }
);

/* =========================
   RED CARDS
========================= */

app.post(
  "/api/players/:id/red-card",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      const result = await pool.query(
        `
        UPDATE players
        SET red_cards=red_cards+1
        WHERE id=$1
        RETURNING *
        `,
        [id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Player not found"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "ADD RED CARD ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not add red card"
      });
    }
  }
);

app.delete(
  "/api/players/:id/red-card",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      const result = await pool.query(
        `
        UPDATE players
        SET red_cards=GREATEST(red_cards-1,0)
        WHERE id=$1
        RETURNING *
        `,
        [id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Player not found"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "REMOVE RED CARD ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not remove red card"
      });
    }
  }
);

/* =========================
   PHOTO
========================= */

app.put(
  "/api/players/:id/photo",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const photo = req.body?.photo || null;

      const result = await pool.query(
        `
        UPDATE players
        SET photo=$1
        WHERE id=$2
        RETURNING *
        `,
        [photo, id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Player not found"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "UPDATE PHOTO ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not update photo"
      });
    }
  }
);

/* =========================
   RATING
========================= */

app.put(
  "/api/players/:id/rating",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const rating = Number(
        req.body?.rating
      );

      if (!Number.isFinite(rating)) {
        return res.status(400).json({
          error: "Invalid rating"
        });
      }

      const result = await pool.query(
        `
        UPDATE players
        SET rating=$1
        WHERE id=$2
        RETURNING *
        `,
        [rating, id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Player not found"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "UPDATE RATING ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not update rating"
      });
    }
  }
);

/* =========================
   STATISTICS
========================= */

app.get(
  "/api/statistics",
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          players.*,
          teams.name AS team_name
        FROM players
        LEFT JOIN teams
          ON teams.id=players.team_id
        ORDER BY
          players.rating DESC,
          players.goals DESC,
          players.assists DESC
      `);

      res.json(result.rows);
    } catch (error) {
      console.error(
        "LOAD STATISTICS ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not load statistics"
      });
    }
  }
);

app.put(
  "/api/players/:id/stats",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      const goals =
        Math.max(
          0,
          Number(req.body?.goals) || 0
        );

      const assists =
        Math.max(
          0,
          Number(req.body?.assists) || 0
        );

      const saves =
        Math.max(
          0,
          Number(req.body?.saves) || 0
        );

      const rating =
        Math.max(
          0,
          Number(req.body?.rating) || 0
        );

      const result = await pool.query(
        `
        UPDATE players
        SET
          goals=$1,
          assists=$2,
          saves=$3,
          rating=$4
        WHERE id=$5
        RETURNING *
        `,
        [
          goals,
          assists,
          saves,
          rating,
          id
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Player not found"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "UPDATE STATS ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not update stats"
      });
    }
  }
);

/* =========================
   POSITION
========================= */

function normalizePosition(position) {
  if (!position) return "";

  const value = String(
    position
  ).trim().toLowerCase();

  if (
    value === "qapıçı" ||
    value === "qapici" ||
    value === "goalkeeper" ||
    value === "gk"
  ) {
    return "Qapıçı";
  }

  if (
    value === "müdafiə" ||
    value === "mudafie" ||
    value === "defender" ||
    value === "df"
  ) {
    return "Müdafiə";
  }

  if (
    value === "yarımmüdafiə" ||
    value === "yarimmudafie" ||
    value === "midfielder" ||
    value === "mf"
  ) {
    return "Yarımmüdafiə";
  }

  if (
    value === "hücum" ||
    value === "hücumçu" ||
    value === "hücumçu" ||
    value === "forvard" ||
    value === "attacker" ||
    value === "forward" ||
    value === "fw"
  ) {
    return "Hücum";
  }

  return position;
}

function getPositionGroup(position) {
  const normalized =
    normalizePosition(position);

  if (normalized === "Qapıçı") {
    return "goalkeeper";
  }

  if (normalized === "Müdafiə") {
    return "defender";
  }

  if (normalized === "Yarımmüdafiə") {
    return "midfielder";
  }

  if (normalized === "Hücum") {
    return "attacker";
  }

  return "";
}

/* =========================
   TEAM OF WEEK
========================= */

app.get(
  "/api/team-of-week",
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          team_of_week.*,

          g.name AS goalkeeper_name,
          g.photo AS goalkeeper_photo,

          d.name AS defender_name,
          d.photo AS defender_photo,

          m.name AS midfielder_name,
          m.photo AS midfielder_photo,

          a.name AS attacker_name,
          a.photo AS attacker_photo

        FROM team_of_week

        LEFT JOIN players g
          ON g.id=team_of_week.goalkeeper_id

        LEFT JOIN players d
          ON d.id=team_of_week.defender_id

        LEFT JOIN players m
          ON m.id=team_of_week.midfielder_id

        LEFT JOIN players a
          ON a.id=team_of_week.attacker_id

        ORDER BY
          team_of_week.created_at DESC
      `);

      res.json(result.rows);
    } catch (error) {
      console.error(
        "LOAD TEAM OF WEEK ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not load team of week"
      });
    }
  }
);

app.post(
  "/api/team-of-week",
  requireAdmin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const week =
        String(
          req.body?.week || ""
        ).trim();

      const goalkeeperId =
        req.body?.goalkeeper_id
          ? Number(req.body.goalkeeper_id)
          : null;

      const defenderId =
        req.body?.defender_id
          ? Number(req.body.defender_id)
          : null;

      const midfielderId =
        req.body?.midfielder_id
          ? Number(req.body.midfielder_id)
          : null;

      const attackerId =
        req.body?.attacker_id
          ? Number(req.body.attacker_id)
          : null;

      if (!week) {
        return res.status(400).json({
          error: "Week required"
        });
      }

      await client.query("BEGIN");

      await client.query(
        `
        DELETE FROM team_of_week
        WHERE week=$1
        `,
        [week]
      );

      const result =
        await client.query(
          `
          INSERT INTO team_of_week
          (
            week,
            goalkeeper_id,
            defender_id,
            midfielder_id,
            attacker_id
          )
          VALUES ($1,$2,$3,$4,$5)
          RETURNING *
          `,
          [
            week,
            goalkeeperId,
            defenderId,
            midfielderId,
            attackerId
          ]
        );

      await client.query("COMMIT");

      res.json(result.rows[0]);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "SAVE TEAM OF WEEK ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not save team of week"
      });
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/team-of-week/:week",
  requireAdmin,
  async (req, res) => {
    try {
      const week =
        String(
          req.params.week || ""
        ).trim();

      await pool.query(
        `
        DELETE FROM team_of_week
        WHERE week=$1
        `,
        [week]
      );

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        "DELETE TEAM OF WEEK ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not delete team of week"
      });
    }
  }
);

/* =========================
   MATCHES
========================= */

app.get(
  "/api/matches",
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          matches.*,

          home_team.name AS home_team_name,
          home_team.logo AS home_team_logo,

          away_team.name AS away_team_name,
          away_team.logo AS away_team_logo

        FROM matches

        LEFT JOIN teams AS home_team
          ON home_team.id=matches.home_team_id

        LEFT JOIN teams AS away_team
          ON away_team.id=matches.away_team_id

        ORDER BY
          matches.match_date DESC NULLS LAST,
          matches.id DESC
      `);

      res.json(result.rows);
    } catch (error) {
      console.error(
        "LOAD MATCHES ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not load matches"
      });
    }
  }
);

app.post(
  "/api/matches",
  requireAdmin,
  async (req, res) => {
    try {
      const homeTeamId =
        Number(req.body?.home_team_id);

      const awayTeamId =
        Number(req.body?.away_team_id);

      const homeScore =
        Number(req.body?.home_score) || 0;

      const awayScore =
        Number(req.body?.away_score) || 0;

      const matchDate =
        req.body?.match_date || null;

      const status =
        req.body?.status ||
        "scheduled";

      if (
        !Number.isInteger(homeTeamId) ||
        !Number.isInteger(awayTeamId)
      ) {
        return res.status(400).json({
          error: "Invalid teams"
        });
      }

      if (homeTeamId === awayTeamId) {
        return res.status(400).json({
          error: "Teams must be different"
        });
      }

      const result = await pool.query(
        `
        INSERT INTO matches
        (
          home_team_id,
          away_team_id,
          home_score,
          away_score,
          match_date,
          status
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING *
        `,
        [
          homeTeamId,
          awayTeamId,
          homeScore,
          awayScore,
          matchDate,
          status
        ]
      );

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "CREATE MATCH ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not create match"
      });
    }
  }
);

app.put(
  "/api/matches/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        Number(req.params.id);

      const homeTeamId =
        Number(req.body?.home_team_id);

      const awayTeamId =
        Number(req.body?.away_team_id);

      const homeScore =
        Number(req.body?.home_score) || 0;

      const awayScore =
        Number(req.body?.away_score) || 0;

      const matchDate =
        req.body?.match_date || null;

      const status =
        req.body?.status ||
        "scheduled";

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error: "Invalid match id"
        });
      }

      const result = await pool.query(
        `
        UPDATE matches
        SET
          home_team_id=$1,
          away_team_id=$2,
          home_score=$3,
          away_score=$4,
          match_date=$5,
          status=$6
        WHERE id=$7
        RETURNING *
        `,
        [
          homeTeamId,
          awayTeamId,
          homeScore,
          awayScore,
          matchDate,
          status,
          id
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Match not found"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "UPDATE MATCH ERROR:",
        error
      );

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
      const id =
        Number(req.params.id);

      await pool.query(
        `
        DELETE FROM matches
        WHERE id=$1
        `,
        [id]
      );

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        "DELETE MATCH ERROR:",
        error
      );

      res.status(500).json({
        error: "Could not delete match"
      });
    }
  }
);

/* =========================
   HEALTH
========================= */

app.get(
  "/api/health",
  async (req, res) => {
    try {
      await pool.query("SELECT 1");

      res.json({
        ok: true,
        database: "connected"
      });
    } catch (error) {
      console.error(
        "HEALTH ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        database: "disconnected"
      });
    }
  }
);

/* =========================
   STATIC
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
      () => {
        console.log(
          `AliScore server running on port ${PORT}`
        );
      }
    );
  })
  .catch(error => {
    console.error(
      "DATABASE INITIALIZATION ERROR:",
      error
    );

    process.exit(1);
  });
