"use strict";

/**
 * Integration tests for CineSearch backend.
 *
 * TMDB HTTP calls are intercepted with axios-mock-adapter so no real
 * network traffic is produced.
 */

// ---------------------------------------------------------------------------
// Set required env vars BEFORE requiring the app
// ---------------------------------------------------------------------------
process.env.TMDB_API_KEY = "test-api-key-for-jest";
process.env.NODE_ENV = "test";
process.env.PORT = "0";

const request = require("supertest");
const axios = require("axios");
const MockAdapter = require("axios-mock-adapter");

// Create mock BEFORE loading the app so tmdbFetch uses the mock instance
const mock = new MockAdapter(axios, { onNoMatch: "throwException" });

const { app, cache } = require("../server");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_MOVIE_LIST = { results: [], total_results: 0, total_pages: 0 };

const MOVIE_LIST = {
    results: [{ id: 27205, title: "Inception", release_date: "2010-07-16", vote_average: 8.4 }],
    total_results: 1,
    total_pages: 1,
};

const PERSON_RESULTS = {
    results: [{ id: 525, name: "Christopher Nolan" }],
};

const EMPTY_PERSON = { results: [] };

function tmdbUrl(path) {
    return new RegExp(`api\\.themoviedb\\.org.*${path.replace("/", "\\/")}`)
}

beforeEach(() => {
    cache.flushAll();
    mock.reset();
});

afterAll(() => {
    mock.restore();
});

// ===========================================================================
// Health check
// ===========================================================================
describe("GET /api/health", () => {
    it("returns 200 with status ok", async () => {
        const res = await request(app).get("/api/health");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("ok");
        expect(res.body.timestamp).toBeDefined();
    });
});

// ===========================================================================
// GET /api/genres
// ===========================================================================
describe("GET /api/genres", () => {
    it("returns genre list from TMDB", async () => {
        const genres = { genres: [{ id: 28, name: "Action" }, { id: 35, name: "Comedy" }] };
        mock.onGet(tmdbUrl("/genre/movie/list")).reply(200, genres);

        const res = await request(app).get("/api/genres");
        expect(res.status).toBe(200);
        expect(res.body.genres).toHaveLength(2);
        expect(res.body.genres[0].name).toBe("Action");
    });

    it("returns 502 when TMDB is unreachable", async () => {
        mock.onGet(tmdbUrl("/genre/movie/list")).networkError();
        const res = await request(app).get("/api/genres");
        expect(res.status).toBe(502);
    });
});

// ===========================================================================
// GET /api/search – validation
// ===========================================================================
describe("GET /api/search – validation", () => {
    it("400 when no search parameters provided", async () => {
        const res = await request(app).get("/api/search");
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/at least one/i);
    });

    it("400 for invalid year (non-numeric string)", async () => {
        const res = await request(app).get("/api/search?query=test&year=abc");
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/invalid year/i);
    });

    it("400 for year too old (before 1880)", async () => {
        const res = await request(app).get("/api/search?query=test&year=1800");
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/invalid year/i);
    });

    it("400 for page = 0", async () => {
        const res = await request(app).get("/api/search?query=test&page=0");
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/page/i);
    });

    it("400 for page > 500", async () => {
        const res = await request(app).get("/api/search?query=test&page=501");
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/page/i);
    });

    it("400 for non-numeric genre", async () => {
        const res = await request(app).get("/api/search?genre=action");
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/genre/i);
    });

    it("400 for cast parameter exceeding 100 chars", async () => {
        const longName = "a".repeat(101);
        const res = await request(app).get(`/api/search?cast=${encodeURIComponent(longName)}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/cast parameter too long/i);
    });

    it("400 for director parameter exceeding 100 chars", async () => {
        const longName = "b".repeat(101);
        const res = await request(app).get(`/api/search?director=${encodeURIComponent(longName)}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/director parameter too long/i);
    });
});

// ===========================================================================
// GET /api/search – title only
// ===========================================================================
describe("GET /api/search – title only", () => {
    it("returns results for a plain title search", async () => {
        mock.onGet(tmdbUrl("/search/movie")).reply(200, MOVIE_LIST);

        const res = await request(app).get("/api/search?query=Inception");
        expect(res.status).toBe(200);
        expect(res.body.results).toHaveLength(1);
        expect(res.body.results[0].title).toBe("Inception");
    });

    it("passes primary_release_year when year is supplied with title", async () => {
        mock.onGet(tmdbUrl("/search/movie")).reply((config) => {
            expect(config.params.primary_release_year).toBe("2010");
            return [200, MOVIE_LIST];
        });

        const res = await request(app).get("/api/search?query=Inception&year=2010");
        expect(res.status).toBe(200);
    });

    it("uses /search/movie endpoint for title-only queries", async () => {
        let calledPath = "";
        mock.onGet(/api\.themoviedb\.org/).reply((config) => {
            calledPath = config.url;
            return [200, MOVIE_LIST];
        });

        await request(app).get("/api/search?query=Inception");
        expect(calledPath).toContain("/search/movie");
    });

    it("returns empty array when TMDB has no results", async () => {
        mock.onGet(tmdbUrl("/search/movie")).reply(200, EMPTY_MOVIE_LIST);

        const res = await request(app).get("/api/search?query=xyznonexistent");
        expect(res.status).toBe(200);
        expect(res.body.results).toEqual([]);
        expect(res.body.total_results).toBe(0);
    });
});

// ===========================================================================
// GET /api/search – year only
// ===========================================================================
describe("GET /api/search – year only", () => {
    it("uses /discover/movie for year-only searches", async () => {
        let calledPath = "";
        mock.onGet(/api\.themoviedb\.org/).reply((config) => {
            calledPath = config.url;
            return [200, MOVIE_LIST];
        });

        const res = await request(app).get("/api/search?year=2010");
        expect(res.status).toBe(200);
        expect(calledPath).toContain("/discover/movie");
    });

    it("passes primary_release_year param for year-only", async () => {
        mock.onGet(tmdbUrl("/discover/movie")).reply((config) => {
            expect(config.params.primary_release_year).toBe("2010");
            return [200, MOVIE_LIST];
        });
        await request(app).get("/api/search?year=2010");
    });
});

// ===========================================================================
// GET /api/search – genre
// ===========================================================================
describe("GET /api/search – genre", () => {
    it("uses /discover/movie with with_genres param", async () => {
        mock.onGet(tmdbUrl("/discover/movie")).reply((config) => {
            expect(config.params.with_genres).toBe("28");
            return [200, MOVIE_LIST];
        });

        const res = await request(app).get("/api/search?genre=28");
        expect(res.status).toBe(200);
        expect(res.body.results).toHaveLength(1);
    });

    it("combines genre with year", async () => {
        mock.onGet(tmdbUrl("/discover/movie")).reply((config) => {
            expect(config.params.with_genres).toBe("28");
            expect(config.params.primary_release_year).toBe("2020");
            return [200, MOVIE_LIST];
        });

        const res = await request(app).get("/api/search?genre=28&year=2020");
        expect(res.status).toBe(200);
    });
});

// ===========================================================================
// GET /api/search – cast
// ===========================================================================
describe("GET /api/search – cast", () => {
    it("resolves actor name to person ID and uses /discover/movie", async () => {
        mock.onGet(tmdbUrl("/search/person")).reply(200, PERSON_RESULTS);
        mock.onGet(tmdbUrl("/discover/movie")).reply((config) => {
            expect(config.params.with_cast).toBe("525");
            return [200, MOVIE_LIST];
        });

        const res = await request(app).get("/api/search?cast=Christopher+Nolan");
        expect(res.status).toBe(200);
        expect(res.body.results).toHaveLength(1);
    });

    it("returns empty results when actor not found in TMDB", async () => {
        mock.onGet(tmdbUrl("/search/person")).reply(200, EMPTY_PERSON);

        const res = await request(app).get("/api/search?cast=UnknownActorXYZ");
        expect(res.status).toBe(200);
        expect(res.body.results).toEqual([]);
        expect(res.body.total_results).toBe(0);
    });
});

// ===========================================================================
// GET /api/search – director
// ===========================================================================
describe("GET /api/search – director", () => {
    it("resolves director name to person ID and passes with_crew", async () => {
        mock.onGet(tmdbUrl("/search/person")).reply(200, PERSON_RESULTS);
        mock.onGet(tmdbUrl("/discover/movie")).reply((config) => {
            expect(config.params.with_crew).toBe("525");
            return [200, MOVIE_LIST];
        });

        const res = await request(app).get("/api/search?director=Christopher+Nolan");
        expect(res.status).toBe(200);
    });

    it("returns empty results when director not found", async () => {
        mock.onGet(tmdbUrl("/search/person")).reply(200, EMPTY_PERSON);

        const res = await request(app).get("/api/search?director=NoSuchDirector");
        expect(res.status).toBe(200);
        expect(res.body.results).toEqual([]);
    });
});

// ===========================================================================
// GET /api/search – combined fields
// ===========================================================================
describe("GET /api/search – combined fields", () => {
    it("title + genre uses /discover/movie with both params", async () => {
        mock.onGet(tmdbUrl("/discover/movie")).reply((config) => {
            expect(config.params.with_genres).toBe("28");
            return [200, MOVIE_LIST];
        });

        const res = await request(app).get("/api/search?query=batman&genre=28");
        expect(res.status).toBe(200);
    });

    it("title + year + genre passes all three params", async () => {
        mock.onGet(tmdbUrl("/discover/movie")).reply((config) => {
            expect(config.params.with_genres).toBe("28");
            expect(config.params.primary_release_year).toBe("2008");
            return [200, MOVIE_LIST];
        });

        const res = await request(app).get("/api/search?query=batman&genre=28&year=2008");
        expect(res.status).toBe(200);
    });

    it("cast + director resolves both person IDs", async () => {
        const actorResult = { results: [{ id: 100, name: "Actor A" }] };
        const directorResult = { results: [{ id: 200, name: "Director B" }] };

        // First person search → cast, second → director
        mock.onGet(tmdbUrl("/search/person")).replyOnce(200, actorResult);
        mock.onGet(tmdbUrl("/search/person")).replyOnce(200, directorResult);

        mock.onGet(tmdbUrl("/discover/movie")).reply((config) => {
            expect(config.params.with_cast).toBe("100");
            expect(config.params.with_crew).toBe("200");
            return [200, MOVIE_LIST];
        });

        const res = await request(app).get("/api/search?cast=Actor+A&director=Director+B");
        expect(res.status).toBe(200);
        expect(res.body.results).toHaveLength(1);
    });
});

// ===========================================================================
// GET /api/search – caching
// ===========================================================================
describe("GET /api/search – caching", () => {
    it("serves second identical request from cache (axios called only once)", async () => {
        let callCount = 0;
        mock.onGet(tmdbUrl("/search/movie")).reply(() => {
            callCount++;
            return [200, MOVIE_LIST];
        });

        await request(app).get("/api/search?query=Inception");
        await request(app).get("/api/search?query=Inception");

        expect(callCount).toBe(1);
    });
});

// ===========================================================================
// GET /api/search – TMDB error handling
// ===========================================================================
describe("GET /api/search – TMDB errors", () => {
    it("returns 502 when TMDB is unreachable", async () => {
        mock.onGet(tmdbUrl("/search/movie")).networkError();
        const res = await request(app).get("/api/search?query=test");
        expect(res.status).toBe(502);
    });

    it("returns 502 on TMDB 500 response", async () => {
        mock.onGet(tmdbUrl("/search/movie")).reply(500, { status_message: "Internal error" });
        const res = await request(app).get("/api/search?query=test");
        expect(res.status).toBe(502);
    });
});

// ===========================================================================
// GET /api/movie/:id
// ===========================================================================
describe("GET /api/movie/:id", () => {
    const DETAIL = {
        id: 27205,
        title: "Inception",
        genres: [{ id: 28, name: "Action" }],
        credits: { cast: [{ id: 6193, name: "Leonardo DiCaprio", character: "Cobb" }], crew: [] },
        videos: { results: [] },
        images: { backdrops: [] },
        reviews: { results: [] },
        recommendations: { results: [] },
    };

    it("returns movie data for valid ID", async () => {
        mock.onGet(tmdbUrl("/movie/27205")).reply(200, DETAIL);

        const res = await request(app).get("/api/movie/27205");
        expect(res.status).toBe(200);
        expect(res.body.title).toBe("Inception");
        expect(res.body.credits.cast[0].name).toBe("Leonardo DiCaprio");
    });

    it("400 for non-numeric ID", async () => {
        const res = await request(app).get("/api/movie/abc");
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/invalid movie id/i);
    });

    it("400 for ID of zero", async () => {
        const res = await request(app).get("/api/movie/0");
        expect(res.status).toBe(400);
    });

    it("returns 404 when TMDB returns 404", async () => {
        mock.onGet(tmdbUrl("/movie/9999999")).reply(404, {
            status_message: "The resource you requested could not be found.",
        });

        const res = await request(app).get("/api/movie/9999999");
        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/not found/i);
    });

    it("returns 502 when TMDB is unreachable", async () => {
        mock.onGet(tmdbUrl("/movie/1")).networkError();
        const res = await request(app).get("/api/movie/1");
        expect(res.status).toBe(502);
    });
});

// ===========================================================================
// GET /api/trending
// ===========================================================================
describe("GET /api/trending", () => {
    it("returns trending movies", async () => {
        mock.onGet(tmdbUrl("/trending/movie/week")).reply(200, MOVIE_LIST);
        const res = await request(app).get("/api/trending");
        expect(res.status).toBe(200);
        expect(res.body.results).toHaveLength(1);
    });

    it("returns 502 when TMDB is unreachable", async () => {
        mock.onGet(tmdbUrl("/trending/movie/week")).networkError();
        const res = await request(app).get("/api/trending");
        expect(res.status).toBe(502);
    });
});

// ===========================================================================
// Unknown routes
// ===========================================================================
describe("Unknown routes", () => {
    it("404 for undefined route", async () => {
        const res = await request(app).get("/api/nonexistent");
        expect(res.status).toBe(404);
    });
});
