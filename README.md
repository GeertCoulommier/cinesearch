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

## CI/CD

| Workflow   | Trigger                  | What it does |
|------------|--------------------------|------------------------------------------|
| **CI**     | push / PR → `main`       | Install → Jest tests + coverage → `npm audit` → Docker image builds → Container health smoke test |
| **CodeQL** | push / PR / weekly       | Static security analysis of all JavaScript |

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

## 📖 How to Use This Guide

**This README provides educational guidance without showing full commands.** Your task is to research and construct the actual Docker commands based on the descriptions provided. All complete command examples are available in [README_FULL.md](README_FULL.md) if you need to verify your work or get unstuck.

This approach encourages hands-on learning and helps you understand what each Docker command does, rather than just copying and pasting.

---

## Getting the Repository

### Using Git (recommended)

If you have Git installed:

```bash
git clone https://github.com/GeertCoulommier/cinesearch.git
cd cinesearch
```

### Using Windows Package Manager (winget) + ZIP Download

On Windows, you can use winget to install `curl` and `unzip`, then download the repository as a ZIP file:

1. **Install curl and unzip** (if not already installed):
   ```bash
   winget install -q curl
   winget install -q GnuWin32.UnZip
   ```

2. **Download the repository as a ZIP file**:
   ```bash
   curl -L https://github.com/GeertCoulommier/cinesearch/archive/refs/heads/main.zip -o cinesearch.zip
   ```

3. **Extract the ZIP file**:
   ```bash
   unzip -q cinesearch.zip
   cd cinesearch-main
   ```

### On macOS or Linux without Git

You can use `curl` and `unzip` (usually pre-installed):

```bash
curl -L https://github.com/GeertCoulommier/cinesearch/archive/refs/heads/main.zip -o cinesearch.zip
unzip -q cinesearch.zip
cd cinesearch-main
```

### Option 1 – Git Clone (recommended)

If you have Git installed, clone the repository from GitHub to your local machine.

### Option 2 – Download as ZIP (Windows/macOS without Git)

If you don't have Git installed:

1. **On Windows with winget:** Install the unzip tool using your package manager if needed
2. **Download the repository:** Visit the GitHub repository and download it as a ZIP file, or use a
   command-line tool to download the ZIP from the repository's archive URL
3. **Extract the ZIP:** Use your unzip tool to extract the downloaded file
4. **Navigate:** Change into the extracted directory

---

## Option A – Docker CLI (no Compose)

This workflow uses raw `docker` commands. For detailed command examples, see [README_FULL.md](README_FULL.md).

This workflow teaches you how Docker works by running commands individually, so you can see exactly what each step does.

### Step 1 – Create your environment file

Copy the example environment file and update it with your TMDB API key. The file should contain your
API key as an environment variable that will be passed to the container at runtime — never baking it
into the image itself.

### Step 2 – Create a shared Docker network

Create a network that allows your containers to communicate with each other by name. This isolates
them from other containers and the host system.

### Step 3 – Build the backend image

Build the Docker image for the Node.js backend. Use the `Dockerfile` in the `backend/` directory.
The Docker layer cache should skip the `npm ci` step on subsequent builds if only your application
code changes (not `package.json`).

### Step 4 – Build the frontend image

Build the Docker image for the Nginx frontend. Use the `Dockerfile` in the `frontend/` directory.
The static files and Nginx configuration should be baked into the image at build time.

### Step 5 – Start the backend container

Run the backend container. For reference, use the suggested container name `cinesearch-backend` and the image you built in Step 3. The following is already configured and provided — you only need to add the container name and image:

Pre-configured network and environment settings:
```
--network cinesearch-net \
--network-alias backend \
--restart unless-stopped \
-e TMDB_API_KEY=$(grep TMDB_API_KEY .env | cut -d= -f2) \
-e PORT=3000 \
-e NODE_ENV=production \
```

**Your task:** Construct a `docker run` command that combines:
- Detached mode (`-d` flag)
- The container name: `cinesearch-backend`
- The pre-configured settings above
- The image name from Step 3

Consult [README_FULL.md](README_FULL.md) for a complete example if needed.

### Step 6 – Start the frontend container

Run the frontend container with:
- Detached mode
- A container name
- Network attachment (same network as the backend)
- Port mapping (80 on host → 80 in container)
- Restart policy

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

For detailed command examples, see [README_FULL.md](README_FULL.md).

Compose manages the entire multi-container application from a single `docker-compose.yml` file.
Instead of running individual `docker` commands, Compose handles network creation, dependency ordering,
environment variable injection, and full lifecycle control with simple commands.

### Step 1 – Create your environment file

Copy the example environment file and update it with your TMDB API key. Compose will automatically
read this file and substitute its variables into `docker-compose.yml` (using syntax like `${TMDB_API_KEY}`).

### Step 2 – Build all images

Use the Docker Compose build command to read the build context and Dockerfile for each service
defined in `docker-compose.yml` and build them. Docker's layer cache applies here too, so repeated
builds are fast.

### Step 3 – Start all services

Use the Docker Compose up command with the detached flag. Compose will automatically:

1. Create the bridge network declared in the Compose file
2. Start the backend first (because the frontend declares a dependency on it)
3. Start the frontend, publishing the host port

### Combined build + start

You can also combine build and start into a single command using the build flag with the up command.
Use this whenever you change application code and want to rebuild and restart without separate commands.

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
