const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");
const webpush = require("web-push");

const app = express();
app.use(express.json({limit:"10mb"}));
app.use(cookieParser());

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";
const JWT_SECRET = process.env.JWT_SECRET || "aliscore-secret";
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@aliscore.app";

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? {rejectUnauthorized:false} : undefined
});

if(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)
  webpush.setVapidDetails(VAPID_SUBJECT,VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY);

async function initDatabase(){
  await pool.query(`CREATE TABLE IF NOT EXISTS teams(
    id SERIAL PRIMARY KEY,name TEXT NOT NULL UNIQUE,logo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

  await pool.query(`CREATE TABLE IF NOT EXISTS matches(
    id SERIAL PRIMARY KEY,home_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    away_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    home_score INTEGER NOT NULL DEFAULT 0,away_score INTEGER NOT NULL DEFAULT 0,
    match_date TIMESTAMPTZ,status TEXT DEFAULT 'scheduled',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

  // Compatibility migration for older AliScore databases.
  // Never delete existing matches/data.
  for(const q of [
    `ALTER TABLE matches ADD COLUMN IF NOT EXISTS home_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE`,
    `ALTER TABLE matches ADD COLUMN IF NOT EXISTS away_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE`,
    `ALTER TABLE matches ADD COLUMN IF NOT EXISTS home_score INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE matches ADD COLUMN IF NOT EXISTS away_score INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_date TIMESTAMPTZ`,
    `ALTER TABLE matches ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled'`
  ]) await pool.query(q);

  await pool.query(`CREATE TABLE IF NOT EXISTS players(
    id SERIAL PRIMARY KEY,name TEXT NOT NULL,team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    position TEXT,number INTEGER,goals INTEGER NOT NULL DEFAULT 0,
    assists INTEGER NOT NULL DEFAULT 0,saves INTEGER NOT NULL DEFAULT 0,
    rating NUMERIC DEFAULT 0,photo TEXT,yellow_cards INTEGER NOT NULL DEFAULT 0,
    red_cards INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

  for(const q of [
    `ALTER TABLE players ADD COLUMN IF NOT EXISTS goals INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE players ADD COLUMN IF NOT EXISTS assists INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE players ADD COLUMN IF NOT EXISTS saves INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE players ADD COLUMN IF NOT EXISTS rating NUMERIC DEFAULT 0`,
    `ALTER TABLE players ADD COLUMN IF NOT EXISTS photo TEXT`,
    `ALTER TABLE players ADD COLUMN IF NOT EXISTS yellow_cards INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE players ADD COLUMN IF NOT EXISTS red_cards INTEGER NOT NULL DEFAULT 0`
  ]) await pool.query(q);

  await pool.query(`CREATE TABLE IF NOT EXISTS team_of_week(
    id SERIAL PRIMARY KEY,week TEXT NOT NULL,goalkeeper_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
    defender_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
    midfielder_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
    attacker_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

  await pool.query(`CREATE TABLE IF NOT EXISTS push_subscriptions(
    id SERIAL PRIMARY KEY,endpoint TEXT NOT NULL UNIQUE,p256dh TEXT NOT NULL,auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

  await pool.query(`CREATE TABLE IF NOT EXISTS transfers(
    id SERIAL PRIMARY KEY,player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    from_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    to_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    fee NUMERIC DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

  await pool.query(`CREATE TABLE IF NOT EXISTS events(
    id SERIAL PRIMARY KEY,match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
    team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
    type TEXT NOT NULL,date TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

  const teamNames=["Xirdalan United","Xirdalan Wolves","Neweli FK","MSN FK","Lotu pişiklər"];
  for(const name of teamNames)
    await pool.query("INSERT INTO teams(name) VALUES($1) ON CONFLICT(name) DO NOTHING",[name]);

  // AliScore tournament seed data. These INSERT/UPDATE operations are idempotent:
  // existing teams, players and matches are preserved and never duplicated.
  const teamsByName={};
  for(const name of teamNames){
    const row=(await pool.query("SELECT id FROM teams WHERE name=$1",[name])).rows[0];
    teamsByName[name]=row.id;
  }

  const playersByTeam={
    "Xirdalan United":["Amil","Elmir","Isa","Huseyin","Umud"],
    "Xirdalan Wolves":["Ali","Emin","Huseyin","Raul"],
    "Neweli FK":["Tofik","Arda","Veli","Emil"],
    "MSN FK":["Fuad","Murad","Samxal","Minə"],
    "Lotu pişiklər":["Ramil","Ayxan","Kamran"]
  };
  for(const [teamName,names] of Object.entries(playersByTeam)){
    for(const name of names){
      await pool.query(
        "INSERT INTO players(name,team_id) SELECT $1,$2 WHERE NOT EXISTS (SELECT 1 FROM players WHERE name=$1 AND team_id=$2)",
        [name,teamsByName[teamName]]
      );
    }
  }

  const results=[
    ["Xirdalan United","MSN FK",0,3,"2026-09-01T18:00:00Z"],
    ["Neweli FK","Xirdalan United",3,5,"2026-09-02T18:00:00Z"],
    ["Xirdalan Wolves","Lotu pişiklər",5,5,"2026-09-03T18:00:00Z"],
    ["MSN FK","Neweli FK",8,10,"2026-09-04T18:00:00Z"],
    ["Xirdalan Wolves","MSN FK",9,9,"2026-09-05T18:00:00Z"],
    ["Xirdalan United","Xirdalan Wolves",3,0,"2026-09-06T18:00:00Z"],
    ["Xirdalan United","Lotu pişiklər",1,0,"2026-09-07T18:00:00Z"],
    ["Lotu pişiklər","MSN FK",4,1,"2026-09-08T18:00:00Z"]
  ];
  for(const [home,away,hs,as,dt] of results){
    const h=teamsByName[home], a=teamsByName[away];
    const existing=(await pool.query(
      "SELECT id FROM matches WHERE home_team_id=$1 AND away_team_id=$2 ORDER BY id LIMIT 1",[h,a]
    )).rows[0];
    if(existing){
      await pool.query(
        "UPDATE matches SET home_score=$1,away_score=$2,status='finished',match_date=COALESCE(match_date,$3) WHERE id=$4",
        [hs,as,dt,existing.id]
      );
    }else{
      await pool.query(
        "INSERT INTO matches(home_team_id,away_team_id,home_score,away_score,match_date,status) VALUES($1,$2,$3,$4,$5,'finished')",
        [h,a,hs,as,dt]
      );
    }
  }
}

function admin(req,res,next){
  try{
    const t=req.cookies?.admin_token;
    if(!t) return res.status(401).json({error:"Unauthorized"});
    const d=jwt.verify(t,JWT_SECRET);
    if(d.role!=="admin") throw new Error();
    req.admin=d; next();
  }catch{return res.status(401).json({error:"Unauthorized"});}
}

async function push(payload){
  if(!VAPID_PUBLIC_KEY||!VAPID_PRIVATE_KEY) return;
  const rows=(await pool.query("SELECT * FROM push_subscriptions")).rows;
  for(const s of rows){
    try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify(payload));}
    catch(e){if(e.statusCode===404||e.statusCode===410) await pool.query("DELETE FROM push_subscriptions WHERE id=$1",[s.id]);}
  }
}

app.get("/api/health",async(req,res)=>{
  try{await pool.query("SELECT 1");res.json({ok:true,database:"connected"});}
  catch(e){res.status(500).json({ok:false,database:"disconnected"});}
});

app.post("/api/admin/login",(req,res)=>{
  if(req.body?.password!==ADMIN_PASSWORD) return res.status(401).json({error:"Wrong password"});
  const token=jwt.sign({role:"admin"},JWT_SECRET,{expiresIn:"7d"});
  res.cookie("admin_token",token,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:604800000});
  res.json({ok:true});
});
app.get("/api/admin/me",(req,res)=>{
  try{const d=jwt.verify(req.cookies?.admin_token||"",JWT_SECRET);res.json({loggedIn:d.role==="admin"});}
  catch{res.json({loggedIn:false});}
});
app.post("/api/admin/logout",(req,res)=>{res.clearCookie("admin_token");res.json({ok:true});});

app.get("/api/push/public-key",(req,res)=>res.json({publicKey:VAPID_PUBLIC_KEY||null}));
app.post("/api/push/subscribe",async(req,res)=>{
  try{
    const s=req.body;
    if(!s?.endpoint||!s?.keys?.p256dh||!s?.keys?.auth) return res.status(400).json({error:"Invalid subscription"});
    await pool.query(`INSERT INTO push_subscriptions(endpoint,p256dh,auth) VALUES($1,$2,$3)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth`,
      [s.endpoint,s.keys.p256dh,s.keys.auth]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"Could not save subscription"});}
});
app.delete("/api/push/subscribe",async(req,res)=>{
  await pool.query("DELETE FROM push_subscriptions WHERE endpoint=$1",[req.body?.endpoint]);
  res.json({ok:true});
});

app.get("/api/teams",async(req,res)=>{
  try{res.json((await pool.query("SELECT * FROM teams ORDER BY name")).rows);}
  catch(e){res.status(500).json({error:"Could not load teams"});}
});
app.post("/api/teams",admin,async(req,res)=>{
  try{const r=await pool.query("INSERT INTO teams(name,logo) VALUES($1,$2) RETURNING *",[String(req.body?.name||"").trim(),req.body?.logo||null]);res.json(r.rows[0]);}
  catch(e){res.status(500).json({error:"Could not create team"});}
});
app.put("/api/teams/:id",admin,async(req,res)=>{
  try{const r=await pool.query("UPDATE teams SET name=$1,logo=$2 WHERE id=$3 RETURNING *",[String(req.body?.name||"").trim(),req.body?.logo||null,Number(req.params.id)]);if(!r.rows.length)return res.status(404).json({error:"Team not found"});res.json(r.rows[0]);}
  catch(e){res.status(500).json({error:"Could not update team"});}
});
app.delete("/api/teams/:id",admin,async(req,res)=>{
  try{await pool.query("DELETE FROM teams WHERE id=$1",[Number(req.params.id)]);res.json({ok:true});}
  catch(e){res.status(500).json({error:"Could not delete team"});}
});

app.get("/api/players",async(req,res)=>{
  try{res.json((await pool.query(`SELECT p.*,t.name team_name FROM players p LEFT JOIN teams t ON t.id=p.team_id ORDER BY p.name`)).rows);}
  catch(e){res.status(500).json({error:"Could not load players"});}
});
app.get("/api/teams/:id/players",async(req,res)=>{
  try{res.json((await pool.query("SELECT * FROM players WHERE team_id=$1 ORDER BY name",[Number(req.params.id)])).rows);}
  catch(e){res.status(500).json({error:"Could not load players"});}
});
app.post("/api/players",admin,async(req,res)=>{
  try{const r=await pool.query(`INSERT INTO players(name,team_id,position,number) VALUES($1,$2,$3,$4) RETURNING *`,
    [String(req.body?.name||"").trim(),req.body?.team_id==null?null:Number(req.body.team_id),req.body?.position||null,req.body?.number==null?null:Number(req.body.number)]);res.json(r.rows[0]);}
  catch(e){res.status(500).json({error:"Could not create player"});}
});
app.put("/api/players/:id",admin,async(req,res)=>{
  try{const r=await pool.query(`UPDATE players SET name=$1,team_id=$2,position=$3,number=$4 WHERE id=$5 RETURNING *`,
    [String(req.body?.name||"").trim(),req.body?.team_id==null?null:Number(req.body.team_id),req.body?.position||null,req.body?.number==null?null:Number(req.body.number),Number(req.params.id)]);if(!r.rows.length)return res.status(404).json({error:"Player not found"});res.json(r.rows[0]);}
  catch(e){res.status(500).json({error:"Could not update player"});}
});
app.delete("/api/players/:id",admin,async(req,res)=>{
  try{await pool.query("DELETE FROM players WHERE id=$1",[Number(req.params.id)]);res.json({ok:true});}
  catch(e){res.status(500).json({error:"Could not delete player"});}
});

app.get("/api/matches",async(req,res)=>{
  try{res.json((await pool.query(`SELECT m.*,h.name home_team_name,h.logo home_team_logo,a.name away_team_name,a.logo away_team_logo
    FROM matches m LEFT JOIN teams h ON h.id=m.home_team_id LEFT JOIN teams a ON a.id=m.away_team_id
    ORDER BY m.match_date DESC NULLS LAST,m.id DESC`)).rows);}
  catch(e){res.status(500).json({error:"Could not load matches"});}
});
app.post("/api/matches",admin,async(req,res)=>{
  try{
    const h=Number(req.body?.home_team_id),a=Number(req.body?.away_team_id);
    if(h===a)return res.status(400).json({error:"Teams must be different"});
    const r=await pool.query(`INSERT INTO matches(home_team_id,away_team_id,home_score,away_score,match_date,status)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[h,a,Number(req.body?.home_score)||0,Number(req.body?.away_score)||0,req.body?.match_date||null,req.body?.status||"scheduled"]);
    res.json(r.rows[0]);
  }catch(e){res.status(500).json({error:"Could not create match"});}
});
app.put("/api/matches/:id",admin,async(req,res)=>{
  try{const r=await pool.query(`UPDATE matches SET home_team_id=$1,away_team_id=$2,home_score=$3,away_score=$4,match_date=$5,status=$6 WHERE id=$7 RETURNING *`,
    [Number(req.body?.home_team_id),Number(req.body?.away_team_id),Number(req.body?.home_score)||0,Number(req.body?.away_score)||0,req.body?.match_date||null,req.body?.status||"scheduled",Number(req.params.id)]);if(!r.rows.length)return res.status(404).json({error:"Match not found"});res.json(r.rows[0]);}
  catch(e){res.status(500).json({error:"Could not update match"});}
});
app.delete("/api/matches/:id",admin,async(req,res)=>{
  try{await pool.query("DELETE FROM matches WHERE id=$1",[Number(req.params.id)]);res.json({ok:true});}
  catch(e){res.status(500).json({error:"Could not delete match"});}
});

app.get("/api/statistics",async(req,res)=>{
  try{res.json((await pool.query(`SELECT p.*,t.name team_name FROM players p LEFT JOIN teams t ON t.id=p.team_id
    ORDER BY p.rating DESC,p.goals DESC,p.assists DESC`)).rows);}
  catch(e){res.status(500).json({error:"Could not load statistics"});}
});
app.put("/api/players/:id/stats",admin,async(req,res)=>{
  try{const r=await pool.query(`UPDATE players SET goals=$1,assists=$2,saves=$3,rating=$4 WHERE id=$5 RETURNING *`,
    [Math.max(0,Number(req.body?.goals)||0),Math.max(0,Number(req.body?.assists)||0),Math.max(0,Number(req.body?.saves)||0),Math.max(0,Number(req.body?.rating)||0),Number(req.params.id)]);res.json(r.rows[0]);}
  catch(e){res.status(500).json({error:"Could not update stats"});}
});
for(const [pathName,col,label] of [["goal","goals","goal"],["yellow-card","yellow_cards","yellow card"],["red-card","red_cards","red card"]]){
  app.post(`/api/players/:id/${pathName}`,admin,async(req,res)=>{
    try{const r=await pool.query(`UPDATE players SET ${col}=${col}+1 WHERE id=$1 RETURNING *`,[Number(req.params.id)]);
      if(label!=="goal") push({title:`${label==="yellow card"?"🟨":"🟥"} AliScore`,body:`Yeni ${label}`,url:"/"}).catch(()=>{});
      res.json(r.rows[0]);}catch(e){res.status(500).json({error:"Could not update player"});}
  });
  app.delete(`/api/players/:id/${pathName}`,admin,async(req,res)=>{
    try{const r=await pool.query(`UPDATE players SET ${col}=GREATEST(${col}-1,0) WHERE id=$1 RETURNING *`,[Number(req.params.id)]);res.json(r.rows[0]);}
    catch(e){res.status(500).json({error:"Could not update player"});}
  });
}
app.put("/api/players/:id/photo",admin,async(req,res)=>{
  try{const r=await pool.query("UPDATE players SET photo=$1 WHERE id=$2 RETURNING *",[req.body?.photo||null,Number(req.params.id)]);res.json(r.rows[0]);}
  catch(e){res.status(500).json({error:"Could not update photo"});}
});
app.put("/api/players/:id/rating",admin,async(req,res)=>{
  try{const r=await pool.query("UPDATE players SET rating=$1 WHERE id=$2 RETURNING *",[Number(req.body?.rating)||0,Number(req.params.id)]);res.json(r.rows[0]);}
  catch(e){res.status(500).json({error:"Could not update rating"});}
});

app.get("/api/team-of-week",async(req,res)=>{
  try{res.json((await pool.query(`SELECT t.*,g.name goalkeeper_name,g.photo goalkeeper_photo,d.name defender_name,d.photo defender_photo,
    m.name midfielder_name,m.photo midfielder_photo,a.name attacker_name,a.photo attacker_photo
    FROM team_of_week t LEFT JOIN players g ON g.id=t.goalkeeper_id LEFT JOIN players d ON d.id=t.defender_id
    LEFT JOIN players m ON m.id=t.midfielder_id LEFT JOIN players a ON a.id=t.attacker_id ORDER BY t.created_at DESC`)).rows);}
  catch(e){res.status(500).json({error:"Could not load team of week"});}
});
app.post("/api/team-of-week",admin,async(req,res)=>{
  const c=await pool.connect();
  try{
    const week=String(req.body?.week||new Date().toISOString().slice(0,10)).trim();
    await c.query("BEGIN");
    await c.query("DELETE FROM team_of_week WHERE week=$1",[week]);
    const r=await c.query(`INSERT INTO team_of_week(week,goalkeeper_id,defender_id,midfielder_id,attacker_id)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,[week,req.body?.goalkeeper_id||null,req.body?.defender_id||null,req.body?.midfielder_id||null,req.body?.attacker_id||null]);
    await c.query("COMMIT");
    push({title:"⭐ AliScore — Komanda həftəsi",body:"Yeni Komanda həftəsi elan edildi.",url:"/"}).catch(()=>{});
    res.json(r.rows[0]);
  }catch(e){await c.query("ROLLBACK").catch(()=>{});res.status(500).json({error:"Could not save team of week"});}
  finally{c.release();}
});
app.delete("/api/team-of-week/:week",admin,async(req,res)=>{
  await pool.query("DELETE FROM team_of_week WHERE week=$1",[req.params.week]);res.json({ok:true});
});

app.get("/api/transfers",async(req,res)=>{
  try{res.json((await pool.query(`SELECT tr.*,p.name player_name,f.name from_team_name,t.name to_team_name
    FROM transfers tr JOIN players p ON p.id=tr.player_id LEFT JOIN teams f ON f.id=tr.from_team_id JOIN teams t ON t.id=tr.to_team_id
    ORDER BY tr.created_at DESC,tr.id DESC`)).rows);}
  catch(e){res.status(500).json({error:"Could not load transfers"});}
});
app.post("/api/transfers",admin,async(req,res)=>{
  const c=await pool.connect();
  try{
    const pid=Number(req.body?.player_id),tid=Number(req.body?.to_team_id),fee=Math.max(0,Number(req.body?.fee)||0);
    await c.query("BEGIN");
    const p=(await c.query(`SELECT p.*,t.name current_team_name FROM players p JOIN teams t ON t.id=p.team_id WHERE p.id=$1 FOR UPDATE`,[pid])).rows[0];
    const t=(await c.query("SELECT * FROM teams WHERE id=$1",[tid])).rows[0];
    if(!p||!t||p.team_id===tid){await c.query("ROLLBACK");return res.status(400).json({error:"Invalid transfer"});}
    const r=await c.query(`INSERT INTO transfers(player_id,from_team_id,to_team_id,fee) VALUES($1,$2,$3,$4) RETURNING *`,[pid,p.team_id,tid,fee]);
    await c.query("UPDATE players SET team_id=$1 WHERE id=$2",[tid,pid]);
    await c.query("COMMIT");
    push({title:"🔄 AliScore — Yeni transfer",body:`${p.name} → ${t.name}`,url:"/"}).catch(()=>{});
    res.json({...r.rows[0],player_name:p.name,from_team_name:p.current_team_name,to_team_name:t.name});
  }catch(e){await c.query("ROLLBACK").catch(()=>{});res.status(500).json({error:"Could not create transfer"});}
  finally{c.release();}
});

app.get("/api/state",async(req,res)=>{
  try{
    const [teams,players,matches,events]=await Promise.all([
      pool.query("SELECT id,name,logo FROM teams ORDER BY name"),
      pool.query("SELECT id,team_id,name,position,number,goals,assists,saves,rating,photo,yellow_cards yellow,red_cards red FROM players ORDER BY name"),
      pool.query("SELECT id,home_team_id home_team,away_team_id away_team,home_score,away_score,status,match_date date FROM matches ORDER BY match_date DESC NULLS LAST,id DESC"),
      pool.query("SELECT id,match_id,team_id,player_id,type,date FROM events ORDER BY date DESC")
    ]);
    res.json({teams:teams.rows,players:players.rows,matches:matches.rows,events:events.rows});
  }catch(e){res.status(500).json({error:"Could not load state"});}
});

app.post("/api/state",admin,async(req,res)=>{
  /* Compatibility endpoint: intentionally does not erase PostgreSQL data.
     The old frontend can call it after local changes; authoritative CRUD endpoints are used by the new UI. */
  res.json({ok:true});
});

app.post("/api/events",admin,async(req,res)=>{
  try{
    const {match_id,team_id,player_id,type}=req.body||{};
    if(!["goal","yellow","red"].includes(type)) return res.status(400).json({error:"Invalid event"});
    const r=await pool.query("INSERT INTO events(match_id,team_id,player_id,type) VALUES($1,$2,$3,$4) RETURNING *",[match_id,team_id,player_id,type]);
    if(type==="goal"){
      await pool.query("UPDATE players SET goals=goals+1 WHERE id=$1",[player_id]);
      await pool.query(`UPDATE matches SET home_score=home_score+CASE WHEN home_team_id=$1 THEN 1 ELSE 0 END,
        away_score=away_score+CASE WHEN away_team_id=$1 THEN 1 ELSE 0 END WHERE id=$2`,[team_id,match_id]);
    }
    if(type==="yellow") await pool.query("UPDATE players SET yellow_cards=yellow_cards+1 WHERE id=$1",[player_id]);
    if(type==="red") await pool.query("UPDATE players SET red_cards=red_cards+1 WHERE id=$1",[player_id]);
    push({title:"AliScore",body:`Yeni ${type} hadisəsi`,url:"/"}).catch(()=>{});
    res.json(r.rows[0]);
  }catch(e){res.status(500).json({error:"Could not create event"});}
});

app.use(express.static(path.join(__dirname,"public")));
app.use((req,res,next)=>{
  if(req.method!=="GET"||req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname,"public","index.html"));
});

initDatabase().then(()=>app.listen(PORT,()=>console.log(`AliScore server running on port ${PORT}`)))
.catch(e=>{console.error("DATABASE INITIALIZATION ERROR:",e);process.exit(1);});
