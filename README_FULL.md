# CineSearch – Docker Build Demo

A movie discovery web application that demonstrates building and running Docker containers. The app queries [The Movie Database (TMDB)](https://www.themoviedb.org/) API and presents rich movie information including posters, cast, trailers, reviews, and recommendations.

> **⚠️ Disclaimer:** This project was built with AI assistance (GitHub Copilot / Claude). It is
> intended solely as a Docker learning exercise. The application code — including the Express server,
> Nginx configuration, and frontend JavaScript — is **not** intended as a reference implementation or
> production-ready example. Do not use it as a template for real-world projects without thorough review.

## Features

- **Multi-field search** – find movies by any combination of:
  - **Title** – keyword search across movie titles
  - **Year** – filter by exact release year (e.g. `2010`)
  - **Genre** – pick from a live TMDB genre dropdown
  - **Cast** – actor name resolved to TMDB person ID
  - **Director** – director name resolved to TMDB person ID
- **Rich movie detail** – poster, genres, director, full cast, trailer, gallery, reviews, recommendations
- **Rate limiting** – 40 req/min per IP + progressive slowdown after 30 req/min
- **In-memory caching** – identical queries served from cache for 10 minutes
- **CI/CD pipeline** – GitHub Actions: tests → audit → Docker builds → container smoke test

## Architecture

```
┌──────────────┐       ┌────────────────────┐       ┌─────────────────┐
│   Browser    │──────>│  Nginx (frontend)  │──────>│  Node.js API    │───> TMDB API
│              │  :80  │  Static files +    │ :3000 │  Rate limiting  │
│              │<──────│  Reverse proxy     │<──────│  Caching        │<───
└──────────────┘       └────────────────────┘       └─────────────────┘
```

- **Frontend** – Nginx serves static HTML/CSS/JS and reverse‑proxies `/api/*` to the backend
- **Backend** – Express.js acts as a secure proxy to TMDB with:
  - **Rate limiting** – max 40 req/min per IP + progressive slowdown after 30 req/min
  - **Nginx rate limiting** – additional 10 req/s limit at the reverse proxy layer
  - **In‑memory caching** – identical queries served from cache for 10 minutes
  - **Debounced search** – frontend waits 400 ms after typing stops before querying

## Search API Reference

`GET /api/search` – all parameters are optional, but **at least one** must be provided.

| Parameter  | Type   | Description                                | Example              |
|------------|--------|--------------------------------------------|----------------------|
| `query`    | string | Movie title keyword(s)                     | `Inception`          |
| `year`     | number | Primary release year (1880–present+5)      | `2010`               |
| `genre`    | number | TMDB genre ID (see `/api/genres`)          | `28` (Action)        |
| `cast`     | string | Actor name – resolved to TMDB person ID    | `Leonardo DiCaprio`  |
| `director` | string | Director name – resolved to TMDB person ID | `Christopher Nolan`  |
| `page`     | number | Results page, 1–500 (default `1`)          | `2`                  |

Other endpoints:

| Endpoint              | Description                              |
|-----------------------|------------------------------------------|
| `GET /api/genres`     | Full TMDB genre list (cached)            |
| `GET /api/movie/:id`  | Full details, credits, trailers, reviews |
| `GET /api/trending`   | Trending movies this week                |
| `GET /api/health`     | Health check                             |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed
- [Docker Compose](https://docs.docker.com/compose/install/) installed (for the Compose workflow)
- A free TMDB API key → [Get one here](https://www.themoviedb.org/settings/api)

> **Port 80:** Both workflows expose the app on port 80. If another process is already using port 80
> on your machine, replace `80:80` with an alternative like `8080:80` and access via
> `http://localhost:8080`.

> **Accessing the app:** The URLs in this guide use `localhost`, which works when your browser runs
> on the same machine as Docker. If Docker is running on a remote server or VM, replace `localhost`
> with the hostname or IP address of that machine — for example `http://192.168.1.50` or
> `http://myserver.local`.

---

## Getting the Repository

### Option 1 – Git Clone (recommended)

If you have Git installed:

```bash
git clone https://github.com/GeertCoulommier/cinesearch.git
cd cinesearch
```

This clones the entire repository with full version history.

### Option 2 – Download as ZIP (Windows/macOS without Git)

If you don't have Git installed, you can download and extract the repository:

#### On Windows with winget:

```bash
# Install unzip (if not already installed)
winget install -q GnuWin32.UnZip

# Download the repository as ZIP
# Visit https://github.com/GeertCoulommier/cinesearch/archive/refs/heads/main.zip
# and extract it manually, or use:
curl -L https://github.com/GeertCoulommier/cinesearch/archive/refs/heads/main.zip -o cinesearch.zip
unzip -q cinesearch.zip
cd cinesearch-main
```

#### On macOS/Linux without Git:

```bash
curl -L https://github.com/GeertCoulommier/cinesearch/archive/refs/heads/main.zip -o cinesearch.zip
unzip -q cinesearch.zip
cd cinesearch-main
```

---

## Option A – Docker CLI (no Compose)

This workflow uses raw `docker` commands so you can see exactly what each step does.

### Step 1 – Create your environment file

```bash
cp .env.example .env
# Open .env and replace 'your_tmdb_api_key_here' with your real TMDB API key
```

The `.env` file stores your secret API key outside of any image or code. It will be passed into the
backend container at runtime via `-e` flags so the key never gets baked into an image layer.

### Step 2 – Create a shared Docker network

```bash
docker network create cinesearch-net
```

Containers cannot talk to each other by name unless they share the same network. This creates an
isolated bridge network. Services on it can reach each other using their container name or alias as
a hostname. Nothing outside this network can initiate connections to them.

### Step 3 – Build the backend image

```bash
docker build -t cinesearch-backend ./backend
```

Docker reads `backend/Dockerfile`, executes each `RUN`/`COPY` instruction as a cacheable layer, and
tags the result `cinesearch-backend:latest`. Because `package.json` is copied before the application
source, the expensive `npm ci` step is skipped on subsequent builds whenever only app code changes.

### Step 4 – Build the frontend image

```bash
docker build -t cinesearch-frontend ./frontend
```

Same process for the Nginx image. The static files (HTML/CSS/JS) and the custom `nginx.conf`
(which includes the `/api/` reverse-proxy rule and rate-limiting zone) are baked into the image at
build time.

### Step 5 – Start the backend container

```bash
docker run -d \
  --name cinesearch-backend \
  --network cinesearch-net \
  --network-alias backend \
  --restart unless-stopped \
  -e TMDB_API_KEY=$(grep TMDB_API_KEY .env | cut -d= -f2) \
  -e PORT=3000 \
  -e NODE_ENV=production \
  cinesearch-backend
```

What each flag does:

| Flag | Purpose |
|------|---------|
| `-d` | Run in the background (detached mode) |
| `--name cinesearch-backend` | Give the container a human-readable name for subsequent commands |
| `--network cinesearch-net` | Attach it to the shared bridge network |
| `--network-alias backend` | Register the DNS name `backend` inside the network — Nginx resolves this hostname to forward API requests |
| `--restart unless-stopped` | Automatically restart after a crash or a Docker daemon restart |
| `-e TMDB_API_KEY=...` | Inject the API key at runtime; it never gets stored in an image layer |
| `-e PORT=3000` | Tell Node.js which port to listen on inside the container |
| `-e NODE_ENV=production` | Enables production-mode behaviour in Express |

No port is published to the host (`-p` is absent). The backend is intentionally reachable only
through the internal network — all external traffic must go through Nginx.

### Step 6 – Start the frontend container

```bash
docker run -d \
  --name cinesearch-frontend \
  --network cinesearch-net \
  --restart unless-stopped \
  -p 80:80 \
  cinesearch-frontend
```

| Flag | Purpose |
|------|---------|
| `-p 80:80` | Map host port 80 → container port 80, making Nginx reachable from the browser |
| `--network cinesearch-net` | Same shared network, so Nginx can DNS-resolve the `backend` alias |

Open **http://localhost** in your browser.

---

### Useful Commands (Docker CLI)

#### View logs

```bash
# Follow live logs for a container (Ctrl-C to stop)
docker logs -f cinesearch-backend
docker logs -f cinesearch-frontend

# Show only the last 50 lines
docker logs --tail 50 cinesearch-backend
```

Morgan (backend) and Nginx (frontend) log every request. Watching both helps you trace the full path
of a request and spot errors from either layer.

#### Check container status and health

```bash
# List running containers with ports and health status
docker ps

# Inspect the health-check result specifically
docker inspect --format '{{.State.Health.Status}}' cinesearch-backend
docker inspect --format '{{.State.Health.Status}}' cinesearch-frontend
```

The `HEALTHCHECK` instructions in both Dockerfiles periodically poll `/api/health` and
`/nginx-health`. Docker marks a container `healthy`, `unhealthy`, or `starting` accordingly.

#### Open a shell inside a container

```bash
docker exec -it cinesearch-backend sh
docker exec -it cinesearch-frontend sh
```

Useful for debugging — inspect files, run one-off commands, or check environment variables with
`printenv`.

#### Stop and remove the containers

```bash
# Stop both containers gracefully (SIGTERM → SIGKILL after timeout)
docker stop cinesearch-frontend cinesearch-backend

# Remove the stopped containers (frees the names for next run)
docker rm cinesearch-frontend cinesearch-backend

# Remove the network
docker network rm cinesearch-net
```

Stop the frontend first so Nginx is no longer accepting new requests before the backend disappears.

#### Rebuild after code changes

```bash
# Rebuild images (unchanged layers are served from cache)
docker build -t cinesearch-backend ./backend
docker build -t cinesearch-frontend ./frontend

# Replace the running containers
docker stop cinesearch-frontend cinesearch-backend
docker rm   cinesearch-frontend cinesearch-backend

# Re-run steps 5 & 6
```

---

## Option B – Docker Compose

Compose manages the entire multi-container application from a single `docker-compose.yml` file. It
handles network creation, dependency ordering, environment variable injection from `.env`, and full
lifecycle control — replacing all the individual `docker` commands above with single-line shortcuts.

### Step 1 – Create your environment file

```bash
cp .env.example .env
# Open .env and replace 'your_tmdb_api_key_here' with your real TMDB API key
```

Compose automatically reads `.env` from the project directory and substitutes its variables into
`docker-compose.yml` (e.g. `${TMDB_API_KEY}`), so your secret key flows into the container without
ever appearing in the Compose file itself.

### Step 2 – Build all images

```bash
docker compose build
```

Reads the `build.context` and `build.dockerfile` for every service in `docker-compose.yml` and
builds them. Docker's layer cache is used exactly as with the manual `docker build` commands, so
repeated builds are fast. To rebuild a single service only:

```bash
docker compose build backend
```

### Step 3 – Start all services

```bash
docker compose up -d
```

Compose performs these steps automatically:

1. Creates the `app-network` bridge network declared in `docker-compose.yml`
2. Starts `backend` first (because `frontend` declares `depends_on: [backend]`)
3. Starts `frontend`, publishing the host port

The `-d` flag (detached) returns control to your terminal. Without it Compose streams all logs to
stdout and blocks until you press Ctrl-C.

Open **http://localhost** in your browser.

### Combined build + start

```bash
docker compose up --build -d
```

Equivalent to running `build` then `up -d` in one step. Use this whenever you change application
code and want to rebuild and restart without separate commands.

---

### Useful Commands (Docker Compose)

#### View logs

```bash
# Follow all services at once (colour-coded by service name)
docker compose logs -f

# Follow a single service
docker compose logs -f backend

# Show the last 100 lines from all services
docker compose logs --tail 100
```

Interleaved, colour-coded output makes it easy to trace a request as it flows from Nginx → Node.js
→ TMDB and back.

#### Check container status and health

```bash
# Show all service containers, their status, and exposed ports
docker compose ps

# Detailed health-check state (uses the full container name from docker compose ps)
docker inspect --format '{{.State.Health.Status}}' cinesearch-backend
docker inspect --format '{{.State.Health.Status}}' cinesearch-frontend
```

#### Open a shell inside a service container

```bash
docker compose exec backend sh
docker compose exec frontend sh
```

Compose resolves the service name to the correct container automatically — no need to remember the
full container name.

#### Stop containers (keep images and volumes)

```bash
docker compose stop
```

Gracefully stops all containers without removing them or the network. Use `docker compose start` to
bring them back up instantly (no rebuild required).

#### Stop and remove everything

```bash
docker compose down
```

Stops and removes the containers and the network. Images are retained so a subsequent
`docker compose up -d` is fast.

To also remove the images:

```bash
docker compose down --rmi all
```

#### Rebuild after code changes

```bash
docker compose up --build -d
```

Compose rebuilds only the images whose source has changed (Docker layer cache), then recreates the
affected containers in-place. Services with unchanged images are left running.

---

## Project Structure

```
cinesearch/
├── docker-compose.yml        # Orchestrates both services
├── .env.example              # Template for environment variables
├── .env                      # Your secrets (git-ignored)
├── .gitignore
├── README.md                 # Quick-start guide (simplified instructions)
├── README_FULL.md            # Complete guide with full command examples
├── backend/
│   ├── Dockerfile            # Node.js 20 Alpine image
│   ├── .dockerignore         # Keeps node_modules out of build context
│   ├── package.json
│   ├── server.js             # Express API with rate limiting & caching
│   └── .env.example
└── frontend/
    ├── Dockerfile            # Nginx Alpine image
    ├── .dockerignore
    ├── nginx.conf            # Reverse proxy + rate limiting config
    ├── index.html
    ├── css/
    │   └── styles.css
    └── js/
        └── app.js            # Vanilla JS SPA with debounced search
```

---

## Key Docker Concepts Demonstrated

| Concept | Where |
|---------|-------|
| Multi-service orchestration | `docker-compose.yml` |
| Custom build contexts | `backend/Dockerfile`, `frontend/Dockerfile` |
| Environment variables | `.env` → `docker-compose.yml` / `-e` flag → container |
| Inter-container networking | `app-network` bridge, `proxy_pass http://backend:3000` |
| Network aliases | `--network-alias backend` (CLI) / service name (Compose) |
| Health checks | `HEALTHCHECK` in both Dockerfiles |
| Security (non-root user) | Backend runs as `appuser` |
| Layer caching optimisation | `COPY package.json` before `COPY .` |
| `.dockerignore` | Keeps `node_modules` out of the build context |

---

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
