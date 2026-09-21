AliScore full restore
Files:
- index.html
- server.js
- package.json
- public/service-worker.js

Do not delete the PostgreSQL database. The server initializes/migrates the existing database and restores the 5 teams, 20 players and 8 known tournament matches if they are missing.
Required Render environment variables:
DATABASE_URL
ADMIN_PASSWORD
JWT_SECRET
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT (optional)
