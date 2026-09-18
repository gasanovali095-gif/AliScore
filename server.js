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
const JWT_SECRET =
  process.env.JWT_SECRET || "change-this-secret-in-render";

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing");
  process.exit(1);
}

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is missing");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      points INTEGER NOT NULL DEFAULT 0,
      played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      goals_for INTEGER NOT NULL DEFAULT 0,
      goals_against INTEGER NOT NULL DEFAULT 0
    );

    ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      home_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      away_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      match_date TEXT NOT NULL DEFAULT '',
      home_score INTEGER,
      away_score INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CHECK (home_team_id <> away_team_id),
      CHECK (home_score IS NULL OR home_score >= 0),
      CHECK (away_score IS NULL OR away_score >= 0)
    );
  `);

  const count = await pool.query(
    "SELECT COUNT(*)::int AS count FROM teams"
  );

  if (count.rows[0].count === 0) {
    const names = [
      "Lotu pişiklər",
      "MSN FK",
      "Neweli FK",
      "Xirdalan United",
      "Xirdalan Wolves"
    ];

    for (const name of names) {
      await pool.query(
        "INSERT INTO teams (name, points) VALUES ($1, 0)",
        [name]
      );
    }
  }
}

function auth(req, res, next) {
  const token = req.cookies.aliscore_admin;

  if (!token) {
    return res.status(401).json({
      error: "Admin giriş tələb olunur"
    });
  }

  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: "Admin sessiyası bitib"
    });
  }
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      database: "connected"
    });
  } catch {
    res.status(500).json({
      ok: false,
      database: "disconnected"
    });
  }
});

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      error: "Şifrə yanlışdır"
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
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie("aliscore_admin");
  res.json({ ok: true });
});

app.get("/api/admin/me", auth, (req, res) => {
  res.json({
    ok: true,
    admin: true
  });
});

/* =========================
   TEAMS
========================= */

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
        goals_for,
        goals_against,
        (goals_for - goals_against) AS goal_difference
      FROM teams
      ORDER BY
        points DESC,
        goal_difference DESC,
        goals_for DESC,
        name ASC
    `);

    res.json(result.rows);
  } catch (e) {
    res.status(500).json({
      error: e.message
    });
  }
});

/* Добавление команды */

app.post("/api/teams", auth, async (req, res) => {
  const name = String(req.body?.name || "").trim();

  const points = Number(
    req.body?.points ?? 0
  );

  if (!name) {
    return res.status(400).json({
      error: "Komanda adı boş ola bilməz"
    });
  }

  if (!Number.isInteger(points) || points < 0) {
    return res.status(400).json({
      error: "Xal 0 və ya daha böyük tam ədəd olmalıdır"
    });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO teams (name, points)
      VALUES ($1, $2)
      RETURNING *
      `,
      [name, points]
    );

    res.json(result.rows[0]);
  } catch {
    res.status(400).json({
      error: "Bu komanda artıq mövcuddur"
    });
  }
});

/* Редактирование команды + ручное изменение Xal */

app.put("/api/teams/:id", auth, async (req, res) => {
  const id = Number(req.params.id);

  const name = String(
    req.body?.name || ""
  ).trim();

  const points = Number(
    req.body?.points
  );

  if (!name) {
    return res.status(400).json({
      error: "Komanda adı boş ola bilməz"
    });
  }

  if (!Number.isInteger(points) || points < 0) {
    return res.status(400).json({
      error: "Xal 0 və ya daha böyük tam ədəd olmalıdır"
    });
  }

  try {
    const result = await pool.query(
      `
      UPDATE teams
      SET
        name = $1,
        points = $2
      WHERE id = $3
      RETURNING *
      `,
      [name, points, id]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "Komanda tapılmadı"
      });
    }

    res.json(result.rows[0]);
  } catch {
    res.status(400).json({
      error: "Bu komanda adı artıq istifadə olunur"
    });
  }
});

/* Удаление команды */

app.delete("/api/teams/:id", auth, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const result = await pool.query(
      `
      DELETE FROM teams
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "Komanda tapılmadı"
      });
    }

    res.json({
      ok: true
    });
  } catch (e) {
    res.status(500).json({
      error: e.message
    });
  }
});

/* =========================
   MATCHES
========================= */

app.get("/api/matches", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        m.id,
        m.match_date,
        m.home_score,
        m.away_score,

        h.name AS home_team,
        a.name AS away_team,

        h.id AS home_team_id,
        a.id AS away_team_id

      FROM matches m

      JOIN teams h
        ON h.id = m.home_team_id

      JOIN teams a
        ON a.id = m.away_team_id

      ORDER BY
        CASE
          WHEN m.home_score IS NULL
            OR m.away_score IS NULL
          THEN 0
          ELSE 1
        END,

        m.match_date ASC,
        m.id ASC
    `);

    res.json(result.rows);
  } catch (e) {
    res.status(500).json({
      error: e.message
    });
  }
});

/* Создание матча */

app.post("/api/matches", auth, async (req, res) => {
  const homeTeamId = Number(
    req.body?.homeTeamId
  );

  const awayTeamId = Number(
    req.body?.awayTeamId
  );

  const matchDate = String(
    req.body?.matchDate || ""
  ).trim();

  if (
    !homeTeamId ||
    !awayTeamId ||
    homeTeamId === awayTeamId
  ) {
    return res.status(400).json({
      error: "İki fərqli komanda seçin"
    });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO matches
      (
        home_team_id,
        away_team_id,
        match_date
      )

      VALUES
      ($1, $2, $3)

      RETURNING *
      `,
      [
        homeTeamId,
        awayTeamId,
        matchDate
      ]
    );

    res.json(result.rows[0]);
  } catch {
    res.status(400).json({
      error: "Matç yaradıla bilmədi"
    });
  }
});

/* Изменение результата */

app.put("/api/matches/:id", auth, async (req, res) => {
  const id = Number(req.params.id);

  const homeScore =
    req.body?.homeScore === "" ||
    req.body?.homeScore == null
      ? null
      : Number(req.body.homeScore);

  const awayScore =
    req.body?.awayScore === "" ||
    req.body?.awayScore == null
      ? null
      : Number(req.body.awayScore);

  const matchDate = String(
    req.body?.matchDate || ""
  ).trim();

  if (
    homeScore !== null &&
    (!Number.isInteger(homeScore) ||
      homeScore < 0)
  ) {
    return res.status(400).json({
      error: "Hesab 0 və ya daha böyük tam ədəd olmalıdır"
    });
  }

  if (
    awayScore !== null &&
    (!Number.isInteger(awayScore) ||
      awayScore < 0)
  ) {
    return res.status(400).json({
      error: "Hesab 0 və ya daha böyük tam ədəd olmalıdır"
    });
  }

  try {
    const result = await pool.query(
      `
      UPDATE matches

      SET
        home_score = $1,
        away_score = $2,
        match_date = $3

      WHERE id = $4

      RETURNING *
      `,
      [
        homeScore,
        awayScore,
        matchDate,
        id
      ]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "Matç tapılmadı"
      });
    }

    await recalculateStats();

    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({
      error: e.message
    });
  }
});

/* Удаление матча */

app.delete("/api/matches/:id", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      DELETE FROM matches
      WHERE id = $1
      RETURNING id
      `,
      [Number(req.params.id)]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "Matç tapılmadı"
      });
    }

    await recalculateStats();

    res.json({
      ok: true
    });
  } catch (e) {
    res.status(500).json({
      error: e.message
    });
  }
});

/* =========================
   STATS
========================= */

/*
  Матчи автоматически считают:

  O  = сыграно
  Q  = победы
  B  = ничьи
  M  = поражения
  AV = разница голов

  Xal = ОЧКИ

  Xal НЕ пересчитывается автоматически.
  Его меняет администратор вручную.
*/

async function recalculateStats() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      UPDATE teams

      SET
        played = 0,
        wins = 0,
        draws = 0,
        losses = 0,
        goals_for = 0,
        goals_against = 0
    `);

    const matches = await client.query(`
      SELECT
        home_team_id,
        away_team_id,
        home_score,
        away_score

      FROM matches

      WHERE
        home_score IS NOT NULL
        AND away_score IS NOT NULL
    `);

    for (const m of matches.rows) {
      const h = m.home_team_id;
      const a = m.away_team_id;

      const hs = m.home_score;
      const as = m.away_score;

      await client.query(
        `
        UPDATE teams

        SET
          played = played + 1,
          goals_for = goals_for + $1,
          goals_against = goals_against + $2

        WHERE id = $3
        `,
        [hs, as, h]
      );

      await client.query(
        `
        UPDATE teams

        SET
          played = played + 1,
          goals_for = goals_for + $1,
          goals_against = goals_against + $2

        WHERE id = $3
        `,
        [as, hs, a]
      );

      if (hs > as) {
        await client.query(
          "UPDATE teams SET wins = wins + 1 WHERE id = $1",
          [h]
        );

        await client.query(
          "UPDATE teams SET losses = losses + 1 WHERE id = $1",
          [a]
        );
      } else if (hs < as) {
        await client.query(
          "UPDATE teams SET losses = losses + 1 WHERE id = $1",
          [h]
        );

        await client.query(
          "UPDATE teams SET wins = wins + 1 WHERE id = $1",
          [a]
        );
      } else {
        await client.query(
          "UPDATE teams SET draws = draws + 1 WHERE id = $1",
          [h]
        );

        await client.query(
          "UPDATE teams SET draws = draws + 1 WHERE id = $1",
          [a]
        );
      }
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/* =========================
   FRONTEND
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

initDb()
  .then(async () => {
    await recalculateStats();

    app.listen(
      PORT,
      () => {
        console.log(
          `AliScore running on port ${PORT}`
        );
      }
    );
  })
  .catch(err => {
    console.error(
      "Database init failed:",
      err
    );

    process.exit(1);
  });
