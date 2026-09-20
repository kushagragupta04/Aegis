# SafeTraiL Deployment Guide
This guide provides complete, step-by-step instructions for deploying SafeTraiL completely for free. We will use **Vercel** for lightning-fast frontend hosting and **Render** (or **Railway**) for hosting your Node.js backend, PostgreSQL database, and Redis cache.

> [!WARNING]
> SafeTraiL requires **PostGIS** (a spatial extension for PostgreSQL) for mapping queries to work. Both Render and Railway support PostGIS.

---

## Phase 1: Deploy Backend & Databases (Render)
Render provides a free tier for web services and PostgreSQL databases.

### 1. Provision the Database
1. Go to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** and select **PostgreSQL**.
3. Name your database (e.g., `safetrail-db`), select your region, and choose the **Free** tier.
4. Once created, go to the database page and copy the **Internal Database URL** and **External Database URL**.

### 2. Enable PostGIS Extension
SafeTraiL's location features require PostGIS. You must enable it in your new Render database.
1. Connect to your Render database using a tool like **pgAdmin**, **DBeaver**, or the `psql` command-line tool using the **External Database URL**.
2. Run this exact SQL command:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```

### 3. Provision Redis (Upstash / Render)
Render recently deprecated free Redis, so the best absolute free alternative is **Upstash**:
1. Go to [Upstash](https://upstash.com) and create a free Redis database.
2. Copy the **Redis connection URL** provided (it looks like `rediss://default:password@xyz.upstash.io:6379`).

### 4. Deploy the Node.js Server
1. Go back to Render Dashboard, click **New +** and select **Web Service**.
2. Connect your GitHub repository containing SafeTraiL.
3. Configure the service:
   - **Root Directory**: `server`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start` (Make sure your `server/package.json` has `"start": "node src/server.js"`)
4. **Environment Variables**: Scroll down and add all of your variables.
   - `PORT`: `10000` (Render's default)
   - `DATABASE_URL`: *(Paste your Render Internal Database URL here)*
   - `REDIS_URL`: *(Paste your Upstash Redis URL here)*
   - `ACCESS_TOKEN_SECRET`: *(A random 32-character string)*
   - `REFRESH_TOKEN_SECRET`: *(Another random 32-character string)*
   - `GOOGLE_MAPS_API_KEY`: *(Your Google Maps key)*
   - *(Include any Twilio variables if you are using SMS feature)*
5. Click **Deploy Web Service**. Render will install packages and start your server. Copy the URL (e.g., `https://safetrail-api.onrender.com`).

---

## Phase 2: Deploy Frontend (Vercel)
The Vercel free tier is perfectly tailored for Vite + React applications.

### 1. Prepare Frontend Configuration
Vercel handles routing for frontend single-page apps (like React). To ensure page refreshes don't return 404 errors, create a `vercel.json` file inside your `client/` folder:

**`client/vercel.json`**
```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

### 2. Deploy to Vercel
1. Go to [Vercel Dashboard](https://vercel.com/dashboard) and log in with GitHub.
2. Click **Add New** > **Project** and import your SafeTraiL GitHub repository.
3. Configure the project:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `client` (Click edit and select the client folder).
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. **Environment Variables**: Unfurl the variables tab and add the following so your frontend connects to your Render backend:
   - `VITE_API_URL`: `https://safetrail-api.onrender.com` (Replace with your actual Render URL).
   - `VITE_SOCKET_URL`: `https://safetrail-api.onrender.com` (Replace with your actual Render URL).
5. Click **Deploy**. Vercel will build your React app and assign it a free `.vercel.app` domain!

---

## Post-Deployment Checklist
1. **Run Migrations:** Your new Render PostgreSQL database is totally empty. Ensure you run your `/server/src/db/migrations` SQL scripts on your new database to generate the tables (using DBeaver, pgAdmin, or your Node backend logic).
2. **CORS:** Ensure your backend (`server/src/server.js`) has CORS configured to accept incoming traffic from your new Vercel domain (e.g., `https://safetrail.vercel.app`).
3. **HTTPS Verification:** Vercel automatically secures your frontend. Double check your API endpoint prefix (`https://` instead of `http://`).

> [!TIP]
> **Why Render + Vercel?** Render's free tier backend web services spin down after 15 minutes of inactivity to save resources, which means the very first request takes 30-60 seconds to "wake up". Vercel is highly optimized for static frontends and will load your site instantaneously regardless of backend sleep state.