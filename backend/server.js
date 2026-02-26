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

// Only apply rate/speed limiters outside of the test environment
if (process.env.NODE_ENV !== "test") {
    app.use("/api/", speedLimiter);
    app.use("/api/", rateLimiter);
}

// Trust proxy (needed for rate limiter to read real client IP behind Nginx)
app.set("trust proxy", 1);

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

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check
app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * GET /api/genres
 * Returns the full TMDB genre list (cached).
 */
app.get("/api/genres", async (_req, res) => {
    try {
        const data = await tmdbFetch("/genre/movie/list", { language: "en" });
        res.json(data);
    } catch (err) {
        console.error("Genre fetch error:", err.message);
        res.status(502).json({ error: "Failed to fetch genres from TMDB." });
    }
});

/**
 * GET /api/search
 *
 * At least one of: query, year, genre, cast, director must be provided.
 *   query    – movie title keyword(s)
 *   year     – primary release year (YYYY)
 *   genre    – TMDB genre ID (numeric)
 *   cast     – actor name (resolved to TMDB person ID)
 *   director – director name (resolved to TMDB person ID)
 *   page     – results page (default 1)
 */
app.get("/api/search", async (req, res) => {
    try {
        const { query, year, genre, cast, director, page = "1" } = req.query;

        // At least one search parameter required
        if (!query && !year && !genre && !cast && !director) {
            return res.status(400).json({
                error: "Provide at least one search parameter: query, year, genre, cast, or director.",
            });
        }

        // Validate year
        if (year !== undefined) {
            const y = Number(year);
            if (!Number.isInteger(y) || y < 1880 || y > new Date().getFullYear() + 5) {
                return res.status(400).json({ error: "Invalid year." });
            }
        }

        // Validate page
        const pageNum = Number(page);
        if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > 500) {
            return res.status(400).json({ error: "page must be an integer between 1 and 500." });
        }

        // Validate genre
        if (genre !== undefined && !/^\d+$/.test(genre)) {
            return res.status(400).json({ error: "genre must be a numeric TMDB genre ID." });
        }

        // Resolve cast person ID
        let castId;
        if (cast) {
            const castTrimmed = cast.trim();
            if (castTrimmed.length > 100) {
                return res.status(400).json({ error: "cast parameter too long." });
            }
            const personSearch = await tmdbFetch("/search/person", {
                query: castTrimmed,
                include_adult: false,
            });
            if (!personSearch.results || personSearch.results.length === 0) {
                return res.json({ results: [], total_results: 0, total_pages: 0, page: pageNum });
            }
            castId = personSearch.results[0].id;
        }

        // Resolve director person ID
        let directorId;
        if (director) {
            const dirTrimmed = director.trim();
            if (dirTrimmed.length > 100) {
                return res.status(400).json({ error: "director parameter too long." });
            }
            const personSearch = await tmdbFetch("/search/person", {
                query: dirTrimmed,
                include_adult: false,
            });
            if (!personSearch.results || personSearch.results.length === 0) {
                return res.json({ results: [], total_results: 0, total_pages: 0, page: pageNum });
            }
            directorId = personSearch.results[0].id;
        }

        // Choose: /search/movie (title-only) vs /discover/movie (any filter)
        let data;
        const useDiscover = !!(genre || castId || directorId || (year && !query));

        if (!useDiscover) {
            // Simple title search with optional year
            const params = { query: query.trim(), page: pageNum, include_adult: false };
            if (year) params.primary_release_year = year;
            data = await tmdbFetch("/search/movie", params);
        } else {
            // Discover for genre / cast / director (+ optional keyword)
            const params = {
                page: pageNum,
                include_adult: false,
                sort_by: "popularity.desc",
            };
            if (query) params.with_keywords = query.trim();
            if (year) params.primary_release_year = year;
            if (genre) params.with_genres = genre;
            if (castId) params.with_cast = String(castId);
            if (directorId) params.with_crew = String(directorId);
            data = await tmdbFetch("/discover/movie", params);

            // Fallback: if discover returns nothing and we have a title query, try /search/movie
            if (query && (!data.results || data.results.length === 0)) {
                const fbParams = { query: query.trim(), page: pageNum, include_adult: false };
                if (year) fbParams.primary_release_year = year;
                data = await tmdbFetch("/search/movie", fbParams);
            }
        }

        res.json({
            results: data.results || [],
            total_results: data.total_results || 0,
            total_pages: data.total_pages || 0,
            page: pageNum,
        });
    } catch (err) {
        console.error("Search error:", err.message);
        res.status(502).json({ error: "Failed to fetch search results from TMDB." });
    }
});

/**
 * GET /api/movie/:id
 * Full movie details including credits, videos, images, recommendations, reviews.
 */
app.get("/api/movie/:id", async (req, res) => {
    try {
        const movieId = Number(req.params.id);
        if (!Number.isInteger(movieId) || movieId <= 0) {
            return res.status(400).json({ error: "Invalid movie ID." });
        }

        const data = await tmdbFetch(`/movie/${movieId}`, {
            append_to_response: "credits,videos,images,recommendations,reviews",
        });

        res.json(data);
    } catch (err) {
        console.error("Movie detail error:", err.message);
        const status = err.response?.status;
        if (status === 404) return res.status(404).json({ error: "Movie not found." });
        res.status(502).json({ error: "Failed to fetch movie details from TMDB." });
    }
});

/**
 * GET /api/trending
 * Trending movies this week.
 */
app.get("/api/trending", async (_req, res) => {
    try {
        const data = await tmdbFetch("/trending/movie/week");
        res.json(data);
    } catch (err) {
        console.error("Trending error:", err.message);
        res.status(502).json({ error: "Failed to fetch trending movies." });
    }
});

// ---------------------------------------------------------------------------
// Start server (skipped when imported by tests)
// ---------------------------------------------------------------------------
/* istanbul ignore next */
if (require.main === module) {
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`CineSearch backend listening on http://0.0.0.0:${PORT}`);
    });
}

module.exports = { app, cache };
