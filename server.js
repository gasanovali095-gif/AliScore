const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");

const app = express();

app.use(express.json());
app.use(cookieParser());

const PORT = process.env.PORT || 10000;

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing");
  process.exit(1);
}

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is missing");
  process.exit(1);
}

if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

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
    ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS played INTEGER DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS wins INTEGER DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS draws INTEGER DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS losses INTEGER DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS goal_difference INTEGER DEFAULT 0
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

  const result = await pool.query(
    "SELECT COUNT(*)::int AS count FROM teams"
  );

  if (result.rows[0].count === 0) {

    const initialTeams = [
      "Lotu pişiklər",
      "MSN FK",
      "Neweli FK",
      "Xirdalan United",
      "Xirdalan Wolves"
    ];

    for (const name of initialTeams) {

      await pool.query(
        `
        INSERT INTO teams
        (name, points, played, wins, draws, losses, goal_difference)
        VALUES ($1, 0, 0, 0, 0, 0, 0)
        `,
        [name]
      );

    }

    console.log("Initial teams created.");

  }

  console.log("Database initialized.");

}

/* =========================
   ADMIN AUTH
========================= */

function requireAdmin(req, res, next) {

  try {

    const token =
      req.cookies.aliscore_admin;

    if (!token) {
      return res.status(401).json({
        error: "Admin login required"
      });
    }

    jwt.verify(token, JWT_SECRET);

    next();

  } catch (error) {

    return res.status(401).json({
      error: "Unauthorized"
    });

  }

}

/* =========================
   ADMIN LOGIN
========================= */

app.post("/api/admin/login", (req, res) => {

  const { password } = req.body;

  if (password !== ADMIN_PASSWORD) {

    return res.status(401).json({
      error: "Wrong password"
    });

  }

  const token = jwt.sign(
    {
      admin: true
    },
    JWT_SECRET,
    {
      expiresIn: "7d"
    }
  );

  res.cookie(
    "aliscore_admin",
    token,
    {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  );

  res.json({
    ok: true
  });

});

app.get("/api/admin/me", (req, res) => {

  try {

    const token =
      req.cookies.aliscore_admin;

    if (!token) {
      return res.status(401).json({
        error: "Not logged in"
      });
    }

    jwt.verify(token, JWT_SECRET);

    res.json({
      ok: true
    });

  } catch (error) {

    res.status(401).json({
      error: "Not logged in"
    });

  }

});

app.post("/api/admin/logout", (req, res) => {

  res.clearCookie("aliscore_admin");

  res.json({
    ok: true
  });

});

/* =========================
   TEAMS
========================= */

/*
  ВАЖНО:

  Команды сразу сортируются на сервере:

  1. points DESC
  2. goal_difference DESC
  3. wins DESC
  4. losses ASC
  5. id ASC
*/

app.get("/api/teams", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT
        id,
        name,
        points,
        played,
        wins,
        draws,
        losses,
        goal_difference
      FROM teams
      ORDER BY
        points DESC,
        goal_difference DESC,
        wins DESC,
        losses ASC,
        id ASC
    `);

    res.json(result.rows);

  } catch (error) {

    console.error("GET /api/teams error:", error);

    res.status(500).json({
      error: "Failed to load teams",
      details: error.message
    });

  }

});

app.post(
  "/api/teams",
  requireAdmin,
  async (req, res) => {

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

      if (!name || !String(name).trim()) {

        return res.status(400).json({
          error: "Team name is required"
        });

      }

      const result = await pool.query(
        `
        INSERT INTO teams
        (
          name,
          points,
          played,
          wins,
          draws,
          losses,
          goal_difference
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *
        `,
        [
          String(name).trim(),
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

      console.error("POST /api/teams error:", error);

      res.status(500).json({
        error: "Failed to add team",
        details: error.message
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

      if (!Number.isInteger(id)) {

        return res.status(400).json({
          error: "Invalid team ID"
        });

      }

      const {
        name,
        points = 0,
        played = 0,
        wins = 0,
        draws = 0,
        losses = 0,
        goal_difference = 0
      } = req.body;

      if (!name || !String(name).trim()) {

        return res.status(400).json({
          error: "Team name is required"
        });

      }

      const result = await pool.query(
        `
        UPDATE teams
        SET
          name = $1,
          points = $2,
          played = $3,
          wins = $4,
          draws = $5,
          losses = $6,
          goal_difference = $7
        WHERE id = $8
        RETURNING *
        `,
        [
          String(name).trim(),
          Number(points) || 0,
          Number(played) || 0,
          Number(wins) || 0,
          Number(draws) || 0,
          Number(losses) || 0,
          Number(goal_difference) || 0,
          id
        ]
      );

      if (result.rows.length === 0) {

        return res.status(404).json({
          error: "Team not found"
        });

      }

      res.json(result.rows[0]);

    } catch (error) {

      console.error("PUT /api/teams error:", error);

      res.status(500).json({
        error: "Failed to update team",
        details: error.message
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
          error: "Invalid team ID"
        });

      }

      const result = await pool.query(
        `
        DELETE FROM teams
        WHERE id = $1
        RETURNING *
        `,
        [id]
      );

      if (result.rows.length === 0) {

        return res.status(404).json({
          error: "Team not found"
        });

      }

      res.json({
        ok: true
      });

    } catch (error) {

      console.error("DELETE /api/teams error:", error);

      res.status(500).json({
        error: "Failed to delete team",
        details: error.message
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
      SELECT
        id,
        match_date,
        home_team_id,
        away_team_id,
        home_score,
        away_score,
        created_at
      FROM matches
      ORDER BY
        match_date DESC,
        id DESC
    `);

    res.json(result.rows);

  } catch (error) {

    console.error("GET /api/matches error:", error);

    res.status(500).json({
      error: "Failed to load matches",
      details: error.message
    });

  }

});

app.post(
  "/api/matches",
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

      const homeId = Number(home_team_id);
      const awayId = Number(away_team_id);
      const homeScore = Number(home_score);
      const awayScore = Number(away_score);

      if (
        !Number.isInteger(homeId) ||
        !Number.isInteger(awayId)
      ) {

        return res.status(400).json({
          error: "Invalid team"
        });

      }

      if (homeId === awayId) {

        return res.status(400).json({
          error: "Teams must be different"
        });

      }

      if (
        !Number.isFinite(homeScore) ||
        !Number.isFinite(awayScore) ||
        homeScore < 0 ||
        awayScore < 0
      ) {

        return res.status(400).json({
          error: "Invalid score"
        });

      }

      const teamsResult = await pool.query(
        `
        SELECT id
        FROM teams
        WHERE id IN ($1, $2)
        `,
        [homeId, awayId]
      );

      if (teamsResult.rows.length !== 2) {

        return res.status(400).json({
          error: "One or both teams do not exist"
        });

      }

      const result = await pool.query(
        `
        INSERT INTO matches
        (
          match_date,
          home_team_id,
          away_team_id,
          home_score,
          away_score
        )
        VALUES
        ($1,$2,$3,$4,$5)
        RETURNING *
        `,
        [
          match_date || "",
          homeId,
          awayId,
          homeScore,
          awayScore
        ]
      );

      res.json(result.rows[0]);

    } catch (error) {

      console.error("POST /api/matches error:", error);

      res.status(500).json({
        error: "Failed to add match",
        details: error.message
      });

    }

  }
);

app.put(
  "/api/matches/:id",
  requireAdmin,
  async (req, res) => {

    try {

      const id = Number(req.params.id);

      const {
        match_date,
        home_team_id,
        away_team_id,
        home_score,
        away_score
      } = req.body;

      const homeId = Number(home_team_id);
      const awayId = Number(away_team_id);
      const homeScore = Number(home_score);
      const awayScore = Number(away_score);

      if (!Number.isInteger(id)) {

        return res.status(400).json({
          error: "Invalid match ID"
        });

      }

      if (
        !Number.isInteger(homeId) ||
        !Number.isInteger(awayId)
      ) {

        return res.status(400).json({
          error: "Invalid team"
        });

      }

      if (homeId === awayId) {

        return res.status(400).json({
          error: "Teams must be different"
        });

      }

      if (
        !Number.isFinite(homeScore) ||
        !Number.isFinite(awayScore) ||
        homeScore < 0 ||
        awayScore < 0
      ) {

        return res.status(400).json({
          error: "Invalid score"
        });

      }

      const result = await pool.query(
        `
        UPDATE matches
        SET
          match_date = $1,
          home_team_id = $2,
          away_team_id = $3,
          home_score = $4,
          away_score = $5
        WHERE id = $6
        RETURNING *
        `,
        [
          match_date || "",
          homeId,
          awayId,
          homeScore,
          awayScore,
          id
        ]
      );

      if (result.rows.length === 0) {

        return res.status(404).json({
          error: "Match not found"
        });

      }

      res.json(result.rows[0]);

    } catch (error) {

      console.error("PUT /api/matches error:", error);

      res.status(500).json({
        error: "Failed to update match",
        details: error.message
      });

    }

  }
);

app.delete(
  "/api/matches/:id",
  requireAdmin,
  async (req, res) => {

    try {

      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {

        return res.status(400).json({
          error: "Invalid match ID"
        });

      }

      const result = await pool.query(
        `
        DELETE FROM matches
        WHERE id = $1
        RETURNING *
        `,
        [id]
      );

      if (result.rows.length === 0) {

        return res.status(404).json({
          error: "Match not found"
        });

      }

      res.json({
        ok: true
      });

    } catch (error) {

      console.error("DELETE /api/matches error:", error);

      res.status(500).json({
        error: "Failed to delete match",
        details: error.message
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

    res.status(500).json({
      ok: false,
      database: "error"
    });

  }

});

/* =========================
   STATIC SITE
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

    console.error(
      "Database initialization failed:",
      error
    );

    process.exit(1);

  });
