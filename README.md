# AliScore

## Render Environment Variables

Set these in Render:

- DATABASE_URL = your PostgreSQL connection string
- ADMIN_PASSWORD = your admin password
- JWT_SECRET = a long random secret

## Render

Create a Web Service connected to this GitHub repository.

Build Command:
npm install

Start Command:
npm start

The app creates the database tables automatically on first start and inserts the five initial teams if the teams table is empty.
