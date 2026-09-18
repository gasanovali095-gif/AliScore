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

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
        (name, number, position, team_id)
        VALUES ($1,0,'',$2)`,
        [player[0], ids[player[1]]]
      );
    }
  }

  console.log("Database initialized");
}

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

/* ADMIN */

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

  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  try {
    jwt.verify(
      req.cookies.aliscore_admin,
      JWT_SECRET
    );

    res.json({ ok: true });

  } catch {
    res.status(401).json({
      error: "Not logged in"
    });
  }
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie("aliscore_admin");
  res.json({ ok: true });
});

/* TEAMS */

app.get("/api/teams", async (req, res) => {
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
});

app.post("/api/teams", requireAdmin, async (req, res) => {
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
});

app.put("/api/teams/:id", requireAdmin, async (req, res) => {
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

  res.json(result.rows[0]);
});

app.delete("/api/teams/:id", requireAdmin, async (req, res) => {
  await pool.query(
    "DELETE FROM teams WHERE id=$1",
    [Number(req.params.id)]
  );

  res.json({ ok: true });
});

/* PLAYERS */

app.get("/api/players", async (req, res) => {
  const result = await pool.query(`
    SELECT
      players.id,
      players.name,
      players.number,
      players.position,
      players.team_id,
      teams.name AS team_name
    FROM players
    JOIN teams ON teams.id = players.team_id
    ORDER BY players.team_id, players.id
  `);

  res.json(result.rows);
});

app.get("/api/teams/:id/players", async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM players
     WHERE team_id=$1
     ORDER BY id`,
    [Number(req.params.id)]
  );

  res.json(result.rows);
});

app.post("/api/players", requireAdmin, async (req, res) => {
  const {
    name,
    number = 0,
    position = "",
    team_id
  } = req.body;

  const result = await pool.query(
    `INSERT INTO players
    (name,number,position,team_id)
    VALUES ($1,$2,$3,$4)
    RETURNING *`,
    [
      name,
      Number(number) || 0,
      position,
      Number(team_id)
    ]
  );

  res.json(result.rows[0]);
});

app.put("/api/players/:id", requireAdmin, async (req, res) => {
  const {
    name,
    number = 0,
    position = "",
    team_id
  } = req.body;

  const result = await pool.query(
    `UPDATE players SET
      name=$1,
      number=$2,
      position=$3,
      team_id=$4
    WHERE id=$5
    RETURNING *`,
    [
      name,
      Number(number) || 0,
      position,
      Number(team_id),
      Number(req.params.id)
    ]
  );

  res.json(result.rows[0]);
});

app.delete("/api/players/:id", requireAdmin, async (req, res) => {
  await pool.query(
    "DELETE FROM players WHERE id=$1",
    [Number(req.params.id)]
  );

  res.json({ ok: true });
});

/* MATCHES */

app.get("/api/matches", async (req, res) => {
  const result = await pool.query(`
    SELECT * FROM matches
    ORDER BY match_date DESC, id DESC
  `);

  res.json(result.rows);
});

app.post("/api/matches", requireAdmin, async (req, res) => {
  const {
    match_date,
    home_team_id,
    away_team_id,
    home_score,
    away_score
  } = req.body;

  const result = await pool.query(
    `INSERT INTO matches
    (match_date,home_team_id,away_team_id,home_score,away_score)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING *`,
    [
      match_date || "",
      Number(home_team_id),
      Number(away_team_id),
      Number(home_score),
      Number(away_score)
    ]
  );

  res.json(result.rows[0]);
});

app.put("/api/matches/:id", requireAdmin, async (req, res) => {
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
      Number(home_score),
      Number(away_score),
      Number(req.params.id)
    ]
  );

  res.json(result.rows[0]);
});

app.delete("/api/matches/:id", requireAdmin, async (req, res) => {
  await pool.query(
    "DELETE FROM matches WHERE id=$1",
    [Number(req.params.id)]
  );

  res.json({ ok: true });
});

/* HEALTH */

app.get("/api/health", async (req, res) => {
  await pool.query("SELECT 1");

  res.json({
    ok: true,
    database: "connected"
  });
});

/* WEBSITE */

app.use(express.static(
  path.join(__dirname, "public")
));

app.get("*splat", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* START */

initDatabase()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `AliScore running on port ${PORT}`
      );
    });
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
