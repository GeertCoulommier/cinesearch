/* ==========================================================================
   CineSearch – Application Logic
   ========================================================================== */
"use strict";

(() => {
    // -----------------------------------------------------------------------
    // Constants & state
    // -----------------------------------------------------------------------
    const API_BASE = "/api";
    const IMG_BASE = "https://image.tmdb.org/t/p/";
    const DEBOUNCE_MS = 400; // debounce search input
    const MIN_QUERY_LENGTH = 2;

    let state = {
        query: "",
        page: 1,
        totalPages: 1,
        results: [],
        previousView: "trending", // "trending" | "results"
    };

    // -----------------------------------------------------------------------
    // DOM references
    // -----------------------------------------------------------------------
    const $ = (sel) => document.querySelector(sel);
    const searchInput = $("#searchInput");
    const clearBtn = $("#clearBtn");
    const searchSpinner = $("#searchSpinner");
    const trendingSection = $("#trendingSection");
    const trendingGrid = $("#trendingGrid");
    const resultsSection = $("#resultsSection");
    const resultsGrid = $("#resultsGrid");
    const resultsTitle = $("#resultsTitle");
    const loadMoreBtn = $("#loadMoreBtn");
    const loadMoreWrap = $("#loadMore");
    const detailSection = $("#detailSection");
    const detailContent = $("#detailContent");
    const backBtn = $("#backBtn");
    const errorToast = $("#errorToast");

    // -----------------------------------------------------------------------
    // Utility helpers
    // -----------------------------------------------------------------------

    /** Debounce function calls */
    function debounce(fn, ms) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    }

    /** Show a brief error toast */
    function showError(message) {
        errorToast.textContent = message;
        errorToast.hidden = false;
        setTimeout(() => (errorToast.hidden = true), 4000);
    }

    /** Build an image URL with TMDB sizing */
    function imgUrl(path, size = "w500") {
        return path ? `${IMG_BASE}${size}${path}` : null;
    }

    /** Escape HTML to prevent XSS */
    function esc(str) {
        const div = document.createElement("div");
        div.textContent = str ?? "";
        return div.innerHTML;
    }

    /** Format date string */
    function fmtDate(dateStr) {
        if (!dateStr) return "N/A";
        return new Date(dateStr).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    }

    /** Format runtime */
    function fmtRuntime(min) {
        if (!min) return "";
        const h = Math.floor(min / 60);
        const m = min % 60;
        return `${h}h ${m}m`;
    }

    /** Format currency */
    function fmtMoney(val) {
        if (!val) return "N/A";
        return "$" + val.toLocaleString("en-US");
    }

    // -----------------------------------------------------------------------
    // API helpers
    // -----------------------------------------------------------------------

    async function apiFetch(path, params = {}) {
        const url = new URL(`${API_BASE}${path}`, window.location.origin);
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

        const res = await fetch(url);
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
    }

    // -----------------------------------------------------------------------
    // Rendering helpers
    // -----------------------------------------------------------------------

    function renderMovieCard(movie) {
        const poster = imgUrl(movie.poster_path, "w342");
        const year = movie.release_date ? movie.release_date.slice(0, 4) : "—";
        const rating = movie.vote_average ? movie.vote_average.toFixed(1) : "—";

        const card = document.createElement("article");
        card.className = "movie-card";
        card.dataset.movieId = movie.id;
        card.innerHTML = `
      ${poster
                ? `<img class="movie-card__poster" src="${poster}" alt="${esc(movie.title)}" loading="lazy" />`
                : `<div class="movie-card__poster no-poster">🎞️</div>`
            }
      <div class="movie-card__info">
        <div class="movie-card__title">${esc(movie.title)}</div>
        <div class="movie-card__meta">
          <span class="movie-card__rating">★ ${rating}</span>
          <span>${year}</span>
        </div>
      </div>
    `;
        card.addEventListener("click", () => openDetail(movie.id));
        return card;
    }

    function renderSkeletons(container, count = 12) {
        container.innerHTML = "";
        for (let i = 0; i < count; i++) {
            const el = document.createElement("div");
            el.className = "skeleton skeleton--card";
            container.appendChild(el);
        }
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /** Show the trending movies on the landing page */
    async function showTrending() {
        trendingSection.hidden = false;
        resultsSection.hidden = true;
        detailSection.hidden = true;

        renderSkeletons(trendingGrid, 12);

        try {
            const data = await apiFetch("/trending");
            trendingGrid.innerHTML = "";
            (data.results || []).slice(0, 18).forEach((m) => {
                trendingGrid.appendChild(renderMovieCard(m));
            });
        } catch (err) {
            showError("Could not load trending movies.");
            trendingGrid.innerHTML = "";
        }
    }

    /** Search for movies */
    async function performSearch(query, page = 1, append = false) {
        if (query.length < MIN_QUERY_LENGTH) return;

        searchSpinner.hidden = false;
        trendingSection.hidden = true;
        resultsSection.hidden = false;
        detailSection.hidden = true;
        resultsTitle.textContent = `Results for "${query}"`;

        if (!append) {
            renderSkeletons(resultsGrid, 12);
            state.results = [];
        }

        try {
            const data = await apiFetch("/search", { query, page });
            state.page = data.page;
            state.totalPages = data.total_pages;
            state.query = query;

            if (!append) resultsGrid.innerHTML = "";

            if (data.results.length === 0 && page === 1) {
                resultsGrid.innerHTML = `<p style="color:var(--clr-text-muted);grid-column:1/-1;">No movies found for "<em>${esc(query)}</em>". Try another title.</p>`;
            }

            data.results.forEach((m) => {
                state.results.push(m);
                resultsGrid.appendChild(renderMovieCard(m));
            });

            loadMoreWrap.hidden = state.page >= state.totalPages;
        } catch (err) {
            showError(err.message || "Search failed.");
            if (!append) resultsGrid.innerHTML = "";
        } finally {
            searchSpinner.hidden = true;
        }
    }

    /** Open movie detail view */
    async function openDetail(movieId) {
        trendingSection.hidden = true;
        resultsSection.hidden = true;
        detailSection.hidden = false;
        detailContent.innerHTML = `<div class="skeleton" style="height:400px;border-radius:var(--radius-lg);"></div>`;

        // Remember where we came from
        state.previousView = state.query ? "results" : "trending";

        try {
            const m = await apiFetch(`/movie/${movieId}`);
            const backdrop = imgUrl(m.backdrop_path, "w1280");
            const poster = imgUrl(m.poster_path, "w500");
            const genres = (m.genres || []).map((g) => `<span class="badge">${esc(g.name)}</span>`).join("");
            const directors = (m.credits?.crew || [])
                .filter((c) => c.job === "Director")
                .map((c) => esc(c.name))
                .join(", ");

            // Cast (top 12)
            const cast = (m.credits?.cast || []).slice(0, 12);
            const castHtml = cast
                .map((c) => {
                    const photo = imgUrl(c.profile_path, "w185");
                    return `
          <div class="cast-card">
            ${photo
                            ? `<img class="cast-card__img" src="${photo}" alt="${esc(c.name)}" loading="lazy" />`
                            : `<div class="cast-card__img no-poster" style="font-size:1.2rem;display:flex;align-items:center;justify-content:center;">👤</div>`
                        }
            <div class="cast-card__name">${esc(c.name)}</div>
            <div class="cast-card__character">${esc(c.character)}</div>
          </div>`;
                })
                .join("");

            // Videos (YouTube trailers)
            const videos = (m.videos?.results || [])
                .filter((v) => v.site === "YouTube")
                .slice(0, 4);
            const videosHtml = videos
                .map(
                    (v) => `
        <div class="video-card">
          <iframe src="https://www.youtube-nocookie.com/embed/${v.key}" title="${esc(v.name)}" allowfullscreen loading="lazy"></iframe>
        </div>`
                )
                .join("");

            // Images (backdrops)
            const images = (m.images?.backdrops || []).slice(0, 10);
            const imagesHtml = images
                .map(
                    (img) =>
                        `<img class="gallery__img" src="${imgUrl(img.file_path, "w780")}" alt="Scene" loading="lazy" />`
                )
                .join("");

            // Recommendations
            const recs = (m.recommendations?.results || []).slice(0, 8);
            const recsHtml = recs.map((r) => renderMovieCard(r).outerHTML).join("");

            // Reviews
            const reviews = (m.reviews?.results || []).slice(0, 3);
            const reviewsHtml = reviews
                .map(
                    (r) => `
        <div class="review-card">
          <div class="review-card__author">${esc(r.author)} ${r.author_details?.rating ? `<span class="badge badge--gold">★ ${r.author_details.rating}</span>` : ""}</div>
          <div class="review-card__content">${esc(r.content)}</div>
        </div>`
                )
                .join("");

            detailContent.innerHTML = `
        <div class="detail">
          ${backdrop ? `<img class="detail__backdrop" src="${backdrop}" alt="Backdrop" />` : ""}
          <div class="detail__header">
            ${poster ? `<img class="detail__poster" src="${poster}" alt="${esc(m.title)}" />` : ""}
            <div class="detail__meta">
              <h1 class="detail__title">${esc(m.title)} ${m.release_date ? `<span style="font-weight:400;color:var(--clr-text-muted);">(${m.release_date.slice(0, 4)})</span>` : ""}</h1>
              ${m.tagline ? `<p class="detail__tagline">"${esc(m.tagline)}"</p>` : ""}
              <div class="detail__stats">
                ${m.vote_average ? `<span class="badge badge--gold">★ ${m.vote_average.toFixed(1)}</span>` : ""}
                ${m.vote_count ? `<span class="badge">${m.vote_count.toLocaleString()} votes</span>` : ""}
                ${m.runtime ? `<span class="badge badge--accent">⏱ ${fmtRuntime(m.runtime)}</span>` : ""}
                ${m.status ? `<span class="badge">${esc(m.status)}</span>` : ""}
              </div>
              <div class="detail__stats">${genres}</div>
              ${directors ? `<p style="margin-bottom:.75rem;"><strong>Director:</strong> ${directors}</p>` : ""}
              <p><strong>Release:</strong> ${fmtDate(m.release_date)}</p>
              ${m.budget ? `<p><strong>Budget:</strong> ${fmtMoney(m.budget)}</p>` : ""}
              ${m.revenue ? `<p><strong>Revenue:</strong> ${fmtMoney(m.revenue)}</p>` : ""}
              ${m.original_language ? `<p><strong>Language:</strong> ${m.original_language.toUpperCase()}</p>` : ""}
              ${m.homepage ? `<p><a href="${m.homepage}" target="_blank" rel="noopener noreferrer">Official Website ↗</a></p>` : ""}
            </div>
          </div>

          <div class="detail__overview">${esc(m.overview)}</div>

          ${castHtml
                    ? `<div class="detail-section">
                   <h3 class="detail-section__title">Cast</h3>
                   <div class="cast-list">${castHtml}</div>
                 </div>`
                    : ""
                }

          ${videosHtml
                    ? `<div class="detail-section">
                   <h3 class="detail-section__title">Videos</h3>
                   <div class="video-list">${videosHtml}</div>
                 </div>`
                    : ""
                }

          ${imagesHtml
                    ? `<div class="detail-section">
                   <h3 class="detail-section__title">Images</h3>
                   <div class="gallery">${imagesHtml}</div>
                 </div>`
                    : ""
                }

          ${reviewsHtml
                    ? `<div class="detail-section">
                   <h3 class="detail-section__title">Reviews</h3>
                   ${reviewsHtml}
                 </div>`
                    : ""
                }

          ${recsHtml
                    ? `<div class="detail-section">
                   <h3 class="detail-section__title">You Might Also Like</h3>
                   <div class="movie-grid rec-grid">${recsHtml}</div>
                 </div>`
                    : ""
                }
        </div>
      `;

            // Re-attach click handlers on recommendation cards
            detailContent.querySelectorAll(".rec-grid .movie-card").forEach((card) => {
                card.addEventListener("click", () => {
                    openDetail(Number(card.dataset.movieId));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                });
            });
        } catch (err) {
            showError(err.message || "Could not load movie details.");
            detailContent.innerHTML = "";
        }
    }

    // -----------------------------------------------------------------------
    // Event handlers
    // -----------------------------------------------------------------------

    // Debounced search on input
    const debouncedSearch = debounce((value) => {
        const q = value.trim();
        if (q.length >= MIN_QUERY_LENGTH) {
            performSearch(q);
        } else if (q.length === 0) {
            showTrending();
        }
    }, DEBOUNCE_MS);

    searchInput.addEventListener("input", (e) => {
        const val = e.target.value;
        clearBtn.hidden = val.length === 0;
        debouncedSearch(val);
    });

    // Clear button
    clearBtn.addEventListener("click", () => {
        searchInput.value = "";
        clearBtn.hidden = true;
        state.query = "";
        state.page = 1;
        showTrending();
        searchInput.focus();
    });

    // Load more button
    loadMoreBtn.addEventListener("click", () => {
        if (state.page < state.totalPages) {
            performSearch(state.query, state.page + 1, true);
        }
    });

    // Back button
    backBtn.addEventListener("click", () => {
        detailSection.hidden = true;
        if (state.previousView === "results" && state.query) {
            resultsSection.hidden = false;
        } else {
            showTrending();
        }
    });

    // Handle logo click = go home
    document.querySelector(".header__logo").addEventListener("click", (e) => {
        e.preventDefault();
        searchInput.value = "";
        clearBtn.hidden = true;
        state.query = "";
        state.page = 1;
        showTrending();
    });

    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------
    showTrending();
})();
