# Deploying Rank Up! online

The room server now **also serves the game**, so one deploy gives you both:
`https://your-app/` is the game, and it connects to `wss://your-app` for multiplayer automatically.
Everything a player needs is that one URL.

Local dev is unchanged: `python -m http.server 8832` for the game + `cd server && npm start` for the
WebSocket on 8833. The lobby auto-detects which setup it's in.

---

## Recommended: Render.com (free, no credit card, ~30–60s cold start)

**1. Put this folder on GitHub** (one-time). In `rank-up-sim/`:
```bash
git init
git add .
git commit -m "Rank Up online"
```
Create an empty repo on github.com, then:
```bash
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

**2. Deploy on Render:**
- Go to **render.com** → sign up (free, no card) → **New +** → **Blueprint**.
- Connect your GitHub and pick the repo. Render reads `render.yaml` and creates the service.
- (Or **New + → Web Service → Docker**, point it at the repo — same result.)
- Wait for the build. You'll get a URL like `https://rank-up-xxxx.onrender.com`.

**3. Play:** everyone opens that URL, picks a class, types the **same room code**, clicks **PLAY ONLINE**.
The lobby's server field auto-fills to the right `wss://…` — no need to touch it.

> Free-tier note: the service sleeps after ~15 min idle, so the *first* connection after a quiet
> spell takes ~30–60s to wake. Fine for a friend group. (A free uptime pinger like cron-job.org
> hitting `/health` every 10 min keeps it warm if you want.)

---

## Alternative: Fly.io (needs a card for verification, but doesn't sleep as aggressively)

Install `flyctl`, then in `rank-up-sim/`:
```bash
fly launch --dockerfile Dockerfile   # pick a name/region; say no to extra services
fly deploy
```
Fly gives you `https://<app>.fly.dev`. Set the internal port to **8080** (the Dockerfile's `EXPOSE`)
if prompted.

## Any other Docker host

The `Dockerfile` is standard — Railway, Koyeb, Cloud Run, a $5 VPS, etc. all work. The only
requirements: it listens on `$PORT`, exposes HTTP+WebSocket on the same port, and has a `/health`
route. All already handled.

---

## Sanity check after deploy
- Open `https://your-app/health` → should show `{"ok":true,...}`.
- Open `https://your-app/` → the game loads.
- Two people, same room code, PLAY ONLINE → match starts.
