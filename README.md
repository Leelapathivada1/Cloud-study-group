# Cloud Study Group Finder

Full-stack repo:
- Backend: Node.js + Express + Socket.io (signaling + Supabase server-side)
- Database: Supabase (Postgres)
- Frontend: React + Vite
- Video: WebRTC (peer-to-peer mesh)

## Quick start (local)

### 1) Supabase
1. Create a Supabase project (https://app.supabase.com) and run the SQL in `supabase/schema.sql`.
2. Go to Project Settings → API and copy URL and Service Role Key.

### 2) Backend
```bash
cd backend
cp .env.example .env
# edit .env and set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm install
npm start
```

### 3) Frontend
```bash
cd frontend
cp .env.example .env
# (optional) set VITE_API_URL to your backend (default http://localhost:3000)
npm install
npm run dev
```

Open the Vite URL (usually http://localhost:5173). Open two browsers or devices, join the same subject and you should be matched and connected via WebRTC.

## Deploy
- Deploy backend on Railway / Render. Set environment variables from `.env.example`.
- Deploy frontend on Vercel / Netlify and set `VITE_API_URL` to your backend URL.

## Making the repo cloneable & push to your GitHub
After extracting ZIP:

```bash
git init
git add .
git commit -m "Initial commit - Cloud Study Group Finder"
git remote add origin https://github.com/leelapathivada/cloud-study-finder.git
git branch -M main
git push -u origin main
```

## Notes
- Use a TURN server in production for reliability.
- Don't commit service role keys to public repos.
