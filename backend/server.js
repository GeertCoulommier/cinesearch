"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const slowDown = require("express-slow-down");
const helmet = require("helmet");
const cors = require("cors");
const NodeCache = require("node-cache");
const axios = require("axios");
const morgan = require("morgan");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const CACHE_TTL_SECONDS = 600; // 10 minutes
const CACHE_CHECK_PERIOD = 120; // check for expired keys every 2 min

if (!TMDB_API_KEY) {
    console.error("FATAL: TMDB_API_KEY environment variable is not set.");
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Initialise Express & middleware
// ---------------------------------------------------------------------------
const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("combined"));
app.use(express.json());

// ---------------------------------------------------------------------------
// Rate limiting – protects both our server and the upstream TMDB API
// ---------------------------------------------------------------------------

// Slow down: after 30 requests in 1 minute, add 500 ms delay per request
const speedLimiter = slowDown({
    windowMs: 60 * 1000,
    delayAfter: 30,
    delayMs: (hits) => (hits - 30) * 500,
});

// Hard limit: max 40 requests per minute per IP
const rateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Too many requests – please wait a moment and try again.",
    },
});

app.use("/api/", speedLimiter);
app.use("/api/", rateLimiter);

// ---------------------------------------------------------------------------
// Cache – avoids redundant calls to TMDB for identical queries
// ---------------------------------------------------------------------------
const cache = new NodeCache({
    stdTTL: CACHE_TTL_SECONDS,
    checkperiod: CACHE_CHECK_PERIOD,
    useClones: false,
});

/**
 * Fetch from TMDB with caching.
 * @param {string} path  – TMDB API path, e.g. "/search/movie"
 * @param {object} params – query-string parameters (api_key is added automatically)
 * @returns {Promise<object>} parsed JSON response
 */
async function tmdbFetch(path, params = {}) {
    const cacheKey = `${path}|${JSON.stringify(params)}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const response = await axios.get(`${TMDB_BASE_URL}${path}`, {
        params: { api_key: TMDB_API_KEY, ...params },
        timeout: 8000,
    });

    cache.set(cacheKey, response.data);
    return response.data;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check
app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Search movies by title
app.get("/api/search", async (req, res) => {
    try {
        const { query, page = 1 } = req.query;
        if (!query || query.trim().length === 0) {
            return res.status(400).json({ error: "query parameter is required." });
        }

        const data = await tmdbFetch("/search/movie", {
            query: query.trim(),
            page: Number(page),
            include_adult: false,
        });

        res.json(data);
    } catch (err) {
        console.error("Search error:", err.message);
        res.status(err.response?.status || 500).json({
            error: "Failed to fetch search results.",
        });
    }
});

// Get full movie details (with credits, videos, recommendations, etc.)
app.get("/api/movie/:id", async (req, res) => {
    try {
        const movieId = Number(req.params.id);
        if (!movieId || isNaN(movieId)) {
            return res.status(400).json({ error: "Invalid movie ID." });
        }

        const data = await tmdbFetch(`/movie/${movieId}`, {
            append_to_response: "credits,videos,images,recommendations,reviews",
        });

        res.json(data);
    } catch (err) {
        console.error("Movie detail error:", err.message);
        res.status(err.response?.status || 500).json({
            error: "Failed to fetch movie details.",
        });
    }
});

// Get trending movies (for the landing page)
app.get("/api/trending", async (_req, res) => {
    try {
        const data = await tmdbFetch("/trending/movie/week");
        res.json(data);
    } catch (err) {
        console.error("Trending error:", err.message);
        res.status(err.response?.status || 500).json({
            error: "Failed to fetch trending movies.",
        });
    }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend listening on http://0.0.0.0:${PORT}`);
});
