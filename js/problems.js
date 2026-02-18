/* ============================================
   PROBLEMS — LeetCode-style problem list + detail
   Fixed filter counts, performance, company bar,
   status tracking, random picker, discussion,
   sort dropdown, stub treatment, browser history.
   ============================================ */

const Problems = (() => {
  let allProblems = [];
  let tagsData = null;
  let companiesData = null;
  let currentSort = { key: 'id', dir: 'asc' };
  const PAGE_SIZE = 50;
  let currentFiltered = [];
  let currentPage = 1;
  let shellRendered = false;
  let hideStubs = false;
  let featuredListData = null; // For ?list= param
  let activeListId = null;
  let randomQueue = [];
  let randomQueueIndex = -1;
  let randomHistory = []; // Track visited random problems for back navigation
  let randomHistoryIndex = -1;
  let similarityGraph = null; // Pre-computed semantic similarity graph

  // ---- Helpers ----
  function ensureArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    return [val];
  }

  function normalize(p) {
    return {
      id:        typeof p.id === 'number' ? p.id : parseInt(String(p.id).replace(/\D/g, ''), 10),
      title:     p.title || '',
      statement: p.statement || p.question || '',
      solution:  p.solution || '',
      intuition: p.intuition || null,
      hints:     ensureArray(p.hints),
      companies: ensureArray(p.companies || p.company),
      tags:      ensureArray(p.tags || p.subtopics),
      category:  p.category || (p.topics && p.topics[0]) || 'probability',
      difficulty:p.difficulty || 'medium',
      rating:    p.rating || diffToRating(p.difficulty),
      type:      p.type || 'calculation',
      source:    p.source || 'interview',
      status:    p.status === 'title-only' ? 'title-only' : (p.status || 'complete'),
    };
  }

  function diffToRating(d) { return d === 'easy' ? 3 : d === 'hard' ? 8 : 5; }

  // ---- Tier gating ----
  const FREE_PROBLEM_LIMIT = 200;

  function isProblemLocked(problem) {
    // Pro users get everything
    if (typeof Auth !== 'undefined') {
      const tier = Auth.getTier();
      if (tier === 'pro') return false;
      // Debug: log when a problem would be locked so we can verify tier detection
      if (problem.id > FREE_PROBLEM_LIMIT) {
        console.log('[Problems] isProblemLocked: id=' + problem.id + ', tier=' + tier + ', loggedIn=' + Auth.isLoggedIn());
      }
    }
    // Free users: only problems with id <= FREE_PROBLEM_LIMIT
    return problem.id > FREE_PROBLEM_LIMIT;
  }

  function getCatMeta(catId) {
    if (!tagsData || !tagsData.categories) return { name: catId, icon: '\u{1F4C4}', color: '#6366f1' };
    return tagsData.categories.find(c => c.id === catId) || { name: catId, icon: '\u{1F4C4}', color: '#6366f1' };
  }

  function companyShort(id) {
    const map = {
      'citadel': 'Citadel', 'two-sigma': 'Two Sigma', 'de-shaw': 'D.E. Shaw',
      'jump-trading': 'Jump', 'drw': 'DRW', 'hrt': 'HRT', 'jane-street': 'Jane St',
      'optiver': 'Optiver', 'sig': 'SIG', 'squarepoint': 'Squarepoint',
      'tower-research': 'Tower Research', 'millennium': 'Millennium', 'point72': 'Point72',
      'aqr': 'AQR', 'renaissance': 'RenTech', 'five-rings': 'Five Rings',
      'goldman-sachs': 'Goldman Sachs', 'hft': 'HFT',
    };
    return map[id] || id;
  }

  function formatTag(id) {
    if (!id || typeof id !== 'string') return '';
    return id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  function formatType(t) {
    const map = {
      'calculation': 'Calculation', 'proof': 'Proof', 'coding': 'Coding',
      'open-ended': 'Open-Ended', 'brain-teaser': 'Brain Teaser',
      'estimation': 'Estimation', 'strategy': 'Strategy',
      'conceptual': 'Conceptual', 'closed-form': 'Calculation',
      'math': 'Calculation', 'logic': 'Brain Teaser', 'puzzle': 'Brain Teaser',
    };
    return map[t] || t;
  }

  // ---- Status tracking (Auth + localStorage) ----
  function getStatus(id) {
    // Use Auth module if available and user is logged in
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
      return Auth.getStatus(id);
    }
    try { return localStorage.getItem('qr-prep-status-' + id) || ''; }
    catch (e) { return ''; }
  }

  function markStatus(id, status) {
    console.log('[Problems] markStatus called:', id, status);

    // ---- Anti-abuse: Cooldown gate ----
    if (typeof Auth !== 'undefined' && Auth.isStatusOnCooldown && Auth.isStatusOnCooldown(id)) {
      showToast('\u23F3 Please wait before changing status again');
      return;
    }

    // ---- Check if XP will be awarded (for accurate toast) ----
    const willGetXP = (status === 'solved') && (typeof Auth === 'undefined' || !Auth.willAwardXP || Auth.willAwardXP(id));

    // ===== STEP 1: Instant UI feedback (no awaiting anything) =====
    try {
      if (status === 'solved') {
        if (willGetXP) {
          const xpGain = (typeof Auth !== 'undefined' && Auth.getProblemDifficultyXP) ? Auth.getProblemDifficultyXP(id) : 10;
          showToast('\u2705 Solved! +' + xpGain + ' XP', 'xp');
        } else {
          showToast('\u2705 Marked as Solved');
        }
      } else if (status === 'attempted') {
        showToast('\uD83D\uDFE1 Marked as attempted');
      } else {
        showToast('Status cleared');
      }
    } catch (toastErr) {
      console.error('[Problems] Toast error:', toastErr);
    }

    // Update buttons IMMEDIATELY
    const params = App.getParams();
    if (params.id) {
      const actionBar = document.querySelector('.problem-action-bar');
      const solvedBtn = actionBar ? actionBar.querySelector('.pab__btn:first-child') : null;
      const attemptedBtn = actionBar ? actionBar.querySelector('.pab__btn:nth-child(2)') : null;
      if (solvedBtn) {
        solvedBtn.className = 'pab__btn ' + (status === 'solved' ? 'pab__btn--active-green' : '');
        solvedBtn.setAttribute('onclick', "Problems.markStatus(" + id + ", '" + (status === 'solved' ? '' : 'solved') + "')");
        if (status === 'solved') {
          solvedBtn.classList.add('pab__btn--anim-green');
          // Only show XP floater if XP will actually be awarded
          if (willGetXP) {
            const xpGain = (typeof Auth !== 'undefined' && Auth.getProblemDifficultyXP) ? Auth.getProblemDifficultyXP(id) : 10;
            const floater = document.createElement('span');
            floater.className = 'pab__xp-float';
            floater.textContent = '+' + xpGain + ' XP';
            solvedBtn.style.position = 'relative';
            solvedBtn.appendChild(floater);
            setTimeout(() => { floater.remove(); solvedBtn.classList.remove('pab__btn--anim-green'); }, 1000);
          } else {
            setTimeout(() => solvedBtn.classList.remove('pab__btn--anim-green'), 500);
          }
        }
      }
      if (attemptedBtn) {
        attemptedBtn.className = 'pab__btn ' + (status === 'attempted' ? 'pab__btn--active-yellow' : '');
        attemptedBtn.setAttribute('onclick', "Problems.markStatus(" + id + ", '" + (status === 'attempted' ? '' : 'attempted') + "')");
        if (status === 'attempted') {
          attemptedBtn.classList.add('pab__btn--anim-yellow');
          setTimeout(() => attemptedBtn.classList.remove('pab__btn--anim-yellow'), 500);
        }
      }
    } else {
      updateList(params);
    }

    // ===== STEP 2: Persist in background (never blocks UI) =====
    try {
      if (typeof Auth !== 'undefined') {
        Auth.saveStatus(id, status).then((result) => {
          if (result === 'cooldown') return; // Was rejected by cooldown
          // Update level badge after save completes
          if (params.id && Auth.isLoggedIn()) {
            const levelBadge = document.querySelector('.nav__user-level-badge');
            if (levelBadge && Auth.getUserDoc()) {
              const lvl = Auth.calculateLevel(Auth.getUserDoc().xp || 0);
              levelBadge.textContent = 'Lv.' + lvl.level;
            }
          }
        }).catch(err => {
          console.error('[Problems] saveStatus failed:', err);
          showToast('\u26A0\uFE0F Save failed: ' + (err.message || err.code || 'unknown error'));
        });
      } else {
        try {
          if (status) localStorage.setItem('qr-prep-status-' + id, status);
          else localStorage.removeItem('qr-prep-status-' + id);
        } catch (e) { /* ignore */ }
      }
    } catch (err) {
      console.error('[Problems] markStatus error:', err);
    }
  }

  // ---- Notes (localStorage) ----
  function loadNotes(id) {
    try { return localStorage.getItem('qr-prep-notes-' + id) || ''; }
    catch (e) { return ''; }
  }

  function saveNotes(id) {
    const el = document.getElementById('problem-notes');
    if (!el) return;
    try { localStorage.setItem('qr-prep-notes-' + id, el.value); }
    catch (e) { /* ignore */ }
  }

  let notesSaveTimeout;
  function onNotesInput(id) {
    clearTimeout(notesSaveTimeout);
    notesSaveTimeout = setTimeout(() => saveNotes(id), 500);
  }

  // ---- Discussion (localStorage) ----
  function loadDiscussion(id) {
    try {
      const raw = localStorage.getItem('qr-prep-discussion-' + id);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function addDiscussionEntry(id) {
    const input = document.getElementById('discussion-input');
    if (!input || !input.value.trim()) return;
    const entries = loadDiscussion(id);
    entries.push({ text: input.value.trim(), timestamp: Date.now() });
    try { localStorage.setItem('qr-prep-discussion-' + id, JSON.stringify(entries)); }
    catch (e) { /* ignore */ }
    input.value = '';
    renderDiscussionEntries(id);
  }

  function deleteDiscussionEntry(id, ts) {
    let entries = loadDiscussion(id);
    entries = entries.filter(e => e.timestamp !== ts);
    try { localStorage.setItem('qr-prep-discussion-' + id, JSON.stringify(entries)); }
    catch (e) { /* ignore */ }
    renderDiscussionEntries(id);
  }

  function renderDiscussionEntries(id) {
    const container = document.getElementById('discussion-entries');
    if (!container) return;
    const entries = loadDiscussion(id);
    container.innerHTML = entries.length === 0
      ? '<p class="discussion-empty">No discussion notes yet.</p>'
      : entries.map(e => `
          <div class="discussion-entry">
            <div class="discussion-entry__text math-content">${MarkdownRender.render(e.text)}</div>
            <div class="discussion-entry__meta">
              <span class="discussion-entry__time">${new Date(e.timestamp).toLocaleDateString()}</span>
              <button class="discussion-entry__delete" onclick="Problems.deleteDiscussionEntry(${id}, ${e.timestamp})">\u2715</button>
            </div>
          </div>
        `).join('');
    KatexRender.render(container);
  }

  // ---- Cross-filter counts ----
  function computeFilterCounts(problems, params) {
    const activeCat = params.category || params.topic || null;
    const activeCompany = params.company || null;
    const activeDiff = params.difficulty || null;
    const activeType = params.type || null;
    const activeTag = params.tag || null;
    const activeStatus = params.status || null;
    const q = (params.q || '').toLowerCase();

    function applyExcept(exclude) {
      let set = problems;
      if (exclude !== 'category' && activeCat) set = set.filter(p => p.category === activeCat);
      if (exclude !== 'company' && activeCompany) set = set.filter(p => p.companies.includes(activeCompany));
      if (exclude !== 'difficulty' && activeDiff) set = set.filter(p => p.difficulty === activeDiff);
      if (exclude !== 'type' && activeType) set = set.filter(p => p.type === activeType);
      if (exclude !== 'tag' && activeTag) set = set.filter(p => p.tags.includes(activeTag));
      if (exclude !== 'status' && activeStatus) {
        set = set.filter(p => {
          const s = getStatus(p.id);
          if (activeStatus === 'solved') return s === 'solved';
          if (activeStatus === 'attempted') return s === 'attempted';
          if (activeStatus === 'unsolved') return !s;
          return true;
        });
      }
      if (q) {
        set = set.filter(p =>
          p.title.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.tags.some(t => t.toLowerCase().includes(q)) ||
          p.companies.some(c => c.toLowerCase().includes(q))
        );
      }
      return set;
    }

    // Category counts: always global
    const catCounts = {};
    problems.forEach(p => { catCounts[p.category] = (catCounts[p.category] || 0) + 1; });

    // Difficulty counts: filtered by everything except difficulty
    const diffSet = applyExcept('difficulty');
    const diffCounts = { easy: 0, medium: 0, hard: 0 };
    diffSet.forEach(p => { diffCounts[p.difficulty] = (diffCounts[p.difficulty] || 0) + 1; });

    // Type counts: filtered by everything except type
    const typeSet = applyExcept('type');
    const typeCounts = {};
    typeSet.forEach(p => { typeCounts[p.type] = (typeCounts[p.type] || 0) + 1; });

    // Tag counts: filtered by everything except tag
    const tagSet = applyExcept('tag');
    const tagCounts = {};
    tagSet.forEach(p => { p.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }); });

    // Company counts: filtered by everything except company
    const companySet = applyExcept('company');
    const companyCounts = {};
    companySet.forEach(p => { p.companies.forEach(c => { companyCounts[c] = (companyCounts[c] || 0) + 1; }); });

    // Status counts: filtered by everything except status
    const statusSet = applyExcept('status');
    const statusCounts = { solved: 0, attempted: 0, unsolved: 0 };
    statusSet.forEach(p => {
      const s = getStatus(p.id);
      if (s === 'solved') statusCounts.solved++;
      else if (s === 'attempted') statusCounts.attempted++;
      else statusCounts.unsolved++;
    });

    const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
    const sortedCompanies = Object.entries(companyCounts).sort((a, b) => b[1] - a[1]);

    return { catCounts, diffCounts, typeCounts, tagCounts, sortedTags, companyCounts, sortedCompanies, statusCounts };
  }

  // ---- Sorting ----
  function sortProblems(arr, key, dir) {
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let va = a[key], vb = b[key];
      if (key === 'difficulty') {
        const order = { easy: 1, medium: 2, hard: 3 };
        va = order[va] || 2; vb = order[vb] || 2;
      }
      if (key === 'frequency') {
        va = a.companies.length; vb = b.companies.length;
      }
      if (typeof va === 'string') return va.localeCompare(vb) * mult;
      return ((va || 0) - (vb || 0)) * mult;
    });
  }

  function sortArrow(key) {
    if (currentSort.key !== key) return '<span class="sort-arrow">\u21D5</span>';
    return currentSort.dir === 'asc'
      ? '<span class="sort-arrow sort-arrow--active">\u2191</span>'
      : '<span class="sort-arrow sort-arrow--active">\u2193</span>';
  }

  // ---- Back to list URL (preserves filters) ----
  function saveListUrl() {
    try {
      const params = App.getParams();
      // Don't save if we're on a detail view
      if (params.id) return;
      const url = window.location.search || '';
      sessionStorage.setItem('qr-list-url', url);
    } catch (e) { /* ignore */ }
  }

  function getBackToListUrl() {
    try {
      const saved = sessionStorage.getItem('qr-list-url');
      if (saved) return 'problems.html' + saved;
    } catch (e) { /* ignore */ }
    return 'problems.html';
  }

  // ---- O(1) lookup map ----
  let problemMap = new Map(); // id -> problem (built from allProblems)

  function buildLookupMap() {
    problemMap = new Map();
    for (const p of allProblems) {
      problemMap.set(p.id, p);
    }
  }

  function getById(id) {
    id = typeof id === 'number' ? id : parseInt(id, 10);
    return problemMap.get(id) || null;
  }

  // ---- Normalize from index format (short keys) ----
  function normalizeIndex(p) {
    return {
      id:        typeof p.id === 'number' ? p.id : parseInt(String(p.id).replace(/\D/g, ''), 10),
      title:     p.t || p.title || '',
      statement: p.statement || p.question || '',
      solution:  p.solution || '',
      intuition: p.intuition || null,
      hints:     ensureArray(p.hints),
      companies: ensureArray(p.co || p.companies || p.company),
      tags:      ensureArray(p.tg || p.tags || p.subtopics),
      category:  p.c || p.category || (p.topics && p.topics[0]) || 'probability',
      difficulty: p.d || p.difficulty || 'medium',
      rating:    p.r || p.rating || diffToRating(p.d || p.difficulty),
      type:      p.y || p.type || 'calculation',
      source:    p.source || 'interview',
      status:    p.s || p.status || 'complete',
    };
  }

  // ---- Init ----
  async function init() {
    try {
      const params = App.getParams();
      const isDetailView = !!params.id;

      // Load hide-stubs preference (default to true)
      try {
        const stored = localStorage.getItem('qr-prep-hide-stubs');
        hideStubs = stored === null ? true : stored === 'true';
      } catch (e) { hideStubs = true; }

      // FAST PATH: Load only the index first (245KB, cached in sessionStorage)
      // Tags and companies load in background — not needed for first render
      const t0 = performance.now();

      const rawIndex = await DataLoader.problemsIndex();
      const indexData = rawIndex || [];
      console.log('[Problems] Index loaded:', indexData.length, 'problems in', Math.round(performance.now() - t0), 'ms');
      allProblems = indexData.map(normalizeIndex);
      buildLookupMap();

      // Pass problem data to Auth for XP/difficulty lookups
      if (typeof Auth !== 'undefined' && Auth.setProblemData) {
        Auth.setProblemData(allProblems);
      }

      // Support ?list=<id> for featured lists (from Explore page)
      if (params.list) {
        activeListId = params.list;
        try {
          featuredListData = await DataLoader.featuredLists();
          if (featuredListData) {
            const list = featuredListData.featured.find(l => l.id === params.list);
            if (list && list.problemIds) {
              const idSet = new Set(list.problemIds);
              allProblems = allProblems.filter(p => idSet.has(p.id));
              buildLookupMap();
            }
          }
        } catch (e) { /* ignore */ }
      }

      if (isDetailView) {
        // Detail view: render immediately with index data (shows header, nav, meta)
        // Then load full data for statement + solution
        await renderDetailLazy(parseInt(params.id, 10) || params.id);
      } else {
        // Save list URL so back-navigation from detail preserves filters
        saveListUrl();
        // List view: render shell + first page INSTANTLY from index
        // Use default empty tags/companies — sidebar will update when they load
        tagsData = tagsData || { categories: [], types: [] };
        companiesData = companiesData || [];
        renderShell();
        updateList(params);

        // Preload full data in background for fast detail navigation
        DataLoader.preloadFullProblems();
      }

      // Load similarity graph in background (for detail view similar problems)
      DataLoader.similarityGraph().then(g => {
        if (g && g.edges) { similarityGraph = g; console.log('[Problems] Similarity graph loaded:', Object.keys(g.edges).length, 'nodes'); }
      }).catch(() => {});

      // Load tags + companies in background, then re-render sidebar
      if (!tagsData || !tagsData.categories || tagsData.categories.length === 0) {
        Promise.all([DataLoader.tags(), DataLoader.companies()]).then(([rawTags, rawCompanies]) => {
          tagsData = rawTags || { categories: [], types: [] };
          companiesData = rawCompanies || [];
          // Re-render sidebar with proper category names/icons
          if (shellRendered && !App.getParams().id) {
            updateList(App.getParams());
          }
        });
      }

      // Re-render when auth state changes (tier may upgrade from free to pro)
      // Debounce detail re-renders to avoid wiping out animations/toasts
      let authChangeDebounce = null;
      window.addEventListener('auth-state-changed', () => {
        const p = App.getParams();
        if (p.id) {
          // If an animation/toast is active, debounce to avoid wiping it out
          const hasActiveAnimation = document.querySelector('.pab__btn--anim-green, .pab__btn--anim-yellow, .pab__xp-float, .qr-toast--show');
          const delay = hasActiveAnimation ? 1500 : 0;

          clearTimeout(authChangeDebounce);
          authChangeDebounce = setTimeout(() => {
            const numId = parseInt(p.id, 10) || p.id;
            const prob = getById(numId);
            if (prob && prob.statement && prob.statement.length > 20) {
              renderDetail(numId);
            } else {
              renderDetailLazy(numId);
            }
          }, delay);
        } else if (shellRendered) {
          updateList(p);
        }
      });

      // Browser back/forward — restore filters from URL
      window.addEventListener('popstate', () => {
        const p = App.getParams();
        if (p.id) {
          renderDetailLazy(parseInt(p.id, 10) || p.id);
        } else {
          if (!shellRendered) renderShell();
          updateList(p);
        }
      });
    } catch (err) {
      console.error('[Problems] Init error:', err);
      const container = document.getElementById('content');
      if (container) {
        container.innerHTML = `
          <div class="container">
            <div class="empty-state">
              <div class="empty-state__icon">\u26A0\uFE0F</div>
              <div class="empty-state__title">Error loading problems</div>
              <p style="color:var(--text-muted);max-width:600px;margin:0 auto">${err.message}</p>
            </div>
          </div>
        `;
      }
    }
  }

  // ---- Lazy detail rendering: show skeleton from index, then load full data ----
  async function renderDetailLazy(id) {
    const indexProblem = getById(id);
    if (!indexProblem) {
      const container = document.getElementById('content');
      if (container) {
        container.innerHTML = '<div class="container"><div class="empty-state"><div class="empty-state__icon">\u2753</div><div class="empty-state__title">Problem not found</div><a href="problems.html" class="btn btn--primary mt-4">Back to Problems</a></div></div>';
      }
      return;
    }

    // Ensure tags data is loaded for detail view (needed for category meta)
    if (!tagsData || !tagsData.categories || tagsData.categories.length === 0) {
      const [rawTags, rawCompanies] = await Promise.all([DataLoader.tags(), DataLoader.companies()]);
      tagsData = rawTags || { categories: [], types: [] };
      companiesData = rawCompanies || [];
    }

    // If we already have full data (statement/solution), render immediately
    if (indexProblem.statement && indexProblem.statement.length > 20) {
      renderDetail(id);
      return;
    }

    // Show skeleton with index data (title, meta, category — instant)
    renderDetailSkeleton(indexProblem);

    // Try chunk loading first (faster: ~300KB vs 2.7MB)
    let rendered = false;
    if (indexProblem.category) {
      try {
        const prob = await DataLoader.problemByCategory(id, indexProblem.category);
        if (prob && prob.statement && prob.statement.length > 20) {
          // Merge this problem into allProblems for immediate rendering
          const target = allProblems.find(p => p.id === id);
          if (target) {
            target.statement = prob.statement || prob.question || '';
            target.solution = prob.solution || '';
            target.intuition = prob.intuition || null;
            target.hints = ensureArray(prob.hints);
          }
          renderDetail(id);
          rendered = true;
          // Preload remaining data in background for similar problems
          DataLoader.preloadFullProblems();
        }
      } catch (e) { /* fall through to full load */ }
    }

    if (!rendered) {
      // Fallback: Load full problem data (2.7MB)
      const fullData = await DataLoader.problemsFull();
      if (fullData) {
        const fullMap = new Map();
        for (const p of fullData) {
          const nid = typeof p.id === 'number' ? p.id : parseInt(String(p.id).replace(/\D/g, ''), 10);
          fullMap.set(nid, p);
        }
        for (const p of allProblems) {
          const full = fullMap.get(p.id);
          if (full) {
            p.statement = full.statement || full.question || '';
            p.solution = full.solution || '';
            p.intuition = full.intuition || null;
            p.hints = ensureArray(full.hints);
          }
        }
      }
      renderDetail(id);
    }
  }

  // ---- Skeleton for detail view (shows instantly from index) ----
  function renderDetailSkeleton(problem) {
    const container = document.getElementById('content');
    if (!container) return;
    const catMeta = getCatMeta(problem.category);

    container.innerHTML = `
      <div class="container">
        <div class="problem-detail__nav-bar">
          <a href="${getBackToListUrl()}" class="problem-nav-back">\u2190 All Problems</a>
        </div>
        <div class="problem-detail-layout">
          <div class="problem-detail-left">
            <div class="problem-detail__header">
              <div class="problem-detail__meta-row">
                <span class="problem-detail__id-badge">#${problem.id}</span>
                <span class="badge badge--${problem.difficulty}">${problem.difficulty}</span>
                <span class="cat-pill" style="background:${catMeta.color}15;color:${catMeta.color}">${catMeta.icon} ${catMeta.name}</span>
                <span class="problem-detail__type-badge">${formatType(problem.type)}</span>
              </div>
              <h1 class="problem-detail__title">${App.escapeHtml(problem.title)}</h1>
            </div>
            <div class="problem-detail__statement-card" style="opacity:0.5">
              <div class="problem-detail__statement-label">Problem Statement</div>
              <div style="padding:var(--space-4)">
                <div style="height:16px;width:90%;background:var(--bg-card);border-radius:4px;margin-bottom:12px;animation:pulse 1.5s ease-in-out infinite"></div>
                <div style="height:16px;width:75%;background:var(--bg-card);border-radius:4px;margin-bottom:12px;animation:pulse 1.5s ease-in-out infinite"></div>
                <div style="height:16px;width:60%;background:var(--bg-card);border-radius:4px;animation:pulse 1.5s ease-in-out infinite"></div>
              </div>
            </div>
          </div>
          <div class="problem-detail-right">
            <div style="height:200px;background:var(--bg-card);border-radius:var(--radius-lg);opacity:0.3;animation:pulse 1.5s ease-in-out infinite"></div>
          </div>
        </div>
      </div>
    `;
  }

  // ---- Shell (rendered once) ----
  function renderShell() {
    const container = document.getElementById('content');
    if (!container) return;

    container.innerHTML = `
      <div class="container">
        <div class="problems-layout">
          <aside class="problems-sidebar" id="sidebar-left"></aside>
          <div class="problems-main" id="problems-main">
            <div id="problems-header"></div>
            <div class="mobile-cat-filter" id="mobile-cat-filter"></div>
            <div id="tag-cloud-container"></div>
            <div id="company-bar-container"></div>
            <div class="pf-bar" id="pf-bar">
              <input type="text" class="pf-bar__search" id="search" placeholder="Search problems...">
              <div class="pf-bar__right" id="pf-bar-right"></div>
            </div>
            <div id="problems-table-container"></div>
            <div id="load-more-container"></div>
            <div id="empty-state-container"></div>
          </div>
          <aside class="problems-sidebar-right" id="sidebar-right"></aside>
        </div>
      </div>
    `;

    // Bind search (once)
    let searchTimeout;
    document.getElementById('search').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const p = App.getParams();
        p.q = e.target.value || null;
        App.setParams(p);
        updateList(p);
      }, 300);
    });

    shellRendered = true;
  }

  // ---- Update List (called on every filter/sort change) ----
  function updateList(params) {
    // Save current list URL so back-navigation from detail preserves filters
    saveListUrl();
    const main = document.getElementById('problems-main');
    if (main) { main.classList.add('problems-main--updating'); }

    requestAnimationFrame(() => {
      const activeCat = params.category || params.topic || null;
      const activeCompany = params.company || null;
      const activeDiff = params.difficulty || null;
      const activeType = params.type || null;
      const activeTag = params.tag || null;
      const activeStatus = params.status || null;
      const activeFilter = params.filter || null;
      const searchQ = params.q || '';
      const hasFilters = activeCat || activeCompany || activeDiff || activeType || activeTag || activeStatus || activeFilter || searchQ;

      // Base set: always hide duplicates, optionally hide stubs
      // Free users always have stubs hidden (no toggle access)
      let base = allProblems.filter(p => p.status !== 'duplicate');
      const isPro = typeof Auth !== 'undefined' && Auth.getTier && Auth.getTier() === 'pro';
      if (hideStubs || !isPro) base = base.filter(p => p.status !== 'incomplete' && p.status !== 'title-only' && p.status !== 'duplicate');

      // Favorites filter
      if (activeFilter === 'favorites' && typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
        const favs = Auth.getFavorites();
        base = base.filter(p => favs.includes(p.id));
      }

      // Compute cross-filter counts from base
      const counts = computeFilterCounts(base, params);
      const categories = (tagsData.categories || []).filter(c => counts.catCounts[c.id]);

      // Apply all filters for the table
      let filtered = [...base];
      if (activeCat) filtered = filtered.filter(p => p.category === activeCat);
      if (activeCompany) filtered = filtered.filter(p => p.companies.includes(activeCompany));
      if (activeDiff) filtered = filtered.filter(p => p.difficulty === activeDiff);
      if (activeType) filtered = filtered.filter(p => p.type === activeType);
      if (activeTag) filtered = filtered.filter(p => p.tags.includes(activeTag));
      if (activeStatus) {
        filtered = filtered.filter(p => {
          const s = getStatus(p.id);
          if (activeStatus === 'solved') return s === 'solved';
          if (activeStatus === 'attempted') return s === 'attempted';
          if (activeStatus === 'unsolved') return !s;
          return true;
        });
      }
      if (searchQ) {
        const q = searchQ.toLowerCase();
        filtered = filtered.filter(p =>
          p.title.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.tags.some(t => t.toLowerCase().includes(q)) ||
          p.companies.some(c => c.toLowerCase().includes(q))
        );
      }

      sortProblems(filtered, currentSort.key, currentSort.dir);
      currentFiltered = filtered;
      currentPage = 1;

      // ---- Update sidebar ----
      const sidebarEl = document.getElementById('sidebar-left');
      if (sidebarEl) {
        sidebarEl.innerHTML = `
          <div class="sidebar__title">Categories</div>
          <div class="sidebar__categories">
            <button class="sidebar__cat-btn ${!activeCat ? 'sidebar__cat-btn--active' : ''}"
              onclick="Problems.filterCat(null)">
              <span>All Problems</span>
              <span class="sidebar__cat-count">${base.length}</span>
            </button>
            ${categories.map(c => `
              <button class="sidebar__cat-btn ${activeCat === c.id ? 'sidebar__cat-btn--active' : ''}"
                onclick="Problems.filterCat('${c.id}')">
                <span><span class="sidebar__cat-icon">${c.icon}</span>${c.name}</span>
                <span class="sidebar__cat-count">${counts.catCounts[c.id] || 0}</span>
              </button>
            `).join('')}
          </div>

          <div class="sidebar__divider"></div>
          <div class="sidebar__title">Difficulty</div>
          <div class="sidebar__categories">
            ${['easy','medium','hard'].map(d => `
              <button class="sidebar__cat-btn ${activeDiff === d ? 'sidebar__cat-btn--active' : ''}"
                onclick="Problems.filterDiff('${d}')">
                <span><span class="diff-dot diff-${d}"></span>${d.charAt(0).toUpperCase()+d.slice(1)}</span>
                <span class="sidebar__cat-count">${counts.diffCounts[d] || 0}</span>
              </button>
            `).join('')}
          </div>

          <div class="sidebar__divider"></div>
          <div class="sidebar__title">Type</div>
          <div class="sidebar__categories">
            ${(tagsData.types || []).filter(t => counts.typeCounts[t.id]).map(t => `
              <button class="sidebar__cat-btn ${activeType === t.id ? 'sidebar__cat-btn--active' : ''}"
                onclick="Problems.filterType('${t.id}')">
                <span>${t.name}</span>
                <span class="sidebar__cat-count">${counts.typeCounts[t.id] || 0}</span>
              </button>
            `).join('')}
          </div>

          <div class="sidebar__divider"></div>
          <div class="sidebar__title">Status</div>
          <div class="sidebar__categories">
            <button class="sidebar__cat-btn ${activeStatus === 'solved' ? 'sidebar__cat-btn--active' : ''}"
              onclick="Problems.filterStatus('solved')">
              <span>\u2705 Solved</span>
              <span class="sidebar__cat-count">${counts.statusCounts.solved}</span>
            </button>
            <button class="sidebar__cat-btn ${activeStatus === 'attempted' ? 'sidebar__cat-btn--active' : ''}"
              onclick="Problems.filterStatus('attempted')">
              <span>\u{1F7E1} Attempted</span>
              <span class="sidebar__cat-count">${counts.statusCounts.attempted}</span>
            </button>
            <button class="sidebar__cat-btn ${activeStatus === 'unsolved' ? 'sidebar__cat-btn--active' : ''}"
              onclick="Problems.filterStatus('unsolved')">
              <span>\u2B1C Unsolved</span>
              <span class="sidebar__cat-count">${counts.statusCounts.unsolved}</span>
            </button>
          </div>

          ${typeof Auth !== 'undefined' && Auth.isLoggedIn() ? `
            <div class="sidebar__divider"></div>
            <div class="sidebar__title">My Lists</div>
            <div class="sidebar__categories">
              <button class="sidebar__cat-btn ${activeFilter === 'favorites' ? 'sidebar__cat-btn--active' : ''}"
                onclick="Problems.filterFavorites()">
                <span>\u2764\uFE0F Favorites</span>
                <span class="sidebar__cat-count">${Auth.getFavorites().length}</span>
              </button>
            </div>
          ` : ''}
        `;
      }

      // ---- Update header ----
      let headerText = 'All Problems';
      if (activeListId && featuredListData) {
        const list = featuredListData.featured.find(l => l.id === activeListId);
        if (list) headerText = list.title;
      }
      if (activeCat) { const cm = getCatMeta(activeCat); headerText = cm.icon + ' ' + cm.name; }
      if (activeTag) { headerText = 'Tag: ' + formatTag(activeTag); }

      const headerEl = document.getElementById('problems-header');
      if (headerEl) {
        const listBreadcrumb = activeListId ? `<a href="explore.html" style="font-size:var(--text-xs);color:var(--accent);text-decoration:none;margin-bottom:var(--space-1);display:inline-block">\u2190 Back to Explore</a>` : '';
        headerEl.innerHTML = `
          <div class="problems-header">
            ${listBreadcrumb}
            <div class="problems-header__top">
              <h1 class="problems-header__title">${headerText}</h1>
              <div class="problems-header__actions">
                <button class="btn btn--secondary btn--sm" onclick="Problems.randomProblem()">\u{1F3B2} Pick Random</button>
              </div>
            </div>
            <div class="problems-header__meta">
              <span class="problems-header__subtitle">${filtered.length} of ${base.length} problems</span>
              ${isPro ? `<label class="stub-toggle">
                <input type="checkbox" id="hide-stubs-toggle" onchange="Problems.toggleStubs()" ${hideStubs ? 'checked' : ''}>
                <span>Hide incomplete</span>
              </label>` : ''}
            </div>
          </div>
        `;
      }

      // ---- Update mobile category filter ----
      const mobileEl = document.getElementById('mobile-cat-filter');
      if (mobileEl) {
        mobileEl.innerHTML = `
          <select onchange="Problems.filterCat(this.value || null)">
            <option value="">All Categories</option>
            ${categories.map(c => `<option value="${c.id}" ${activeCat===c.id?'selected':''}>${c.icon} ${c.name} (${counts.catCounts[c.id]})</option>`).join('')}
          </select>
        `;
      }

      // ---- Update tag cloud ----
      const TOP_TAGS = 30;
      const topTags = counts.sortedTags.slice(0, TOP_TAGS);
      const remainingTags = counts.sortedTags.slice(TOP_TAGS);

      const tagCloudEl = document.getElementById('tag-cloud-container');
      if (tagCloudEl) {
        tagCloudEl.innerHTML = `
          <div class="tag-cloud">
            <div class="tag-cloud__header">
              <span class="tag-cloud__title">Topics</span>
              ${activeTag ? '<button class="tag-cloud__clear" onclick="Problems.filterTag(null)">Clear filter &times;</button>' : ''}
            </div>
            <div class="tag-cloud__pills" id="tag-pills">
              ${topTags.map(([tag, count]) => `
                <button class="tag-cloud__pill ${activeTag === tag ? 'tag-cloud__pill--active' : ''}"
                  onclick="Problems.filterTag('${tag}')">
                  ${formatTag(tag)} <span class="tag-cloud__count">${count}</span>
                </button>
              `).join('')}
              ${remainingTags.length > 0 ? `
                <button class="tag-cloud__expand" id="tag-expand"
                  onclick="Problems.toggleTagCloud()">
                  +${remainingTags.length} more
                </button>
              ` : ''}
            </div>
            <div class="tag-cloud__expanded" id="tag-expanded" style="display:none">
              ${remainingTags.map(([tag, count]) => `
                <button class="tag-cloud__pill ${activeTag === tag ? 'tag-cloud__pill--active' : ''}"
                  onclick="Problems.filterTag('${tag}')">
                  ${formatTag(tag)} <span class="tag-cloud__count">${count}</span>
                </button>
              `).join('')}
            </div>
          </div>
        `;
      }

      // ---- Update company bar ----
      const companyBarEl = document.getElementById('company-bar-container');
      if (companyBarEl) {
        companyBarEl.innerHTML = counts.sortedCompanies.length > 0 ? `
          <div class="company-bar">
            <div class="company-bar__header">
              <span class="company-bar__title">Companies</span>
              ${activeCompany ? '<button class="company-bar__clear" onclick="Problems.filterCompany(null)">Clear &times;</button>' : ''}
              <input type="text" class="company-bar__search" placeholder="Search..."
                id="company-search" oninput="Problems.filterCompanySearch(this.value)">
            </div>
            <div class="company-bar__scroll">
              <button class="company-bar__arrow" onclick="Problems.scrollCompanies(-1)">\u2039</button>
              <div class="company-bar__pills" id="company-pills">
                ${counts.sortedCompanies.map(([cId, cnt]) => `
                  <button class="company-bar__pill ${activeCompany === cId ? 'company-bar__pill--active' : ''}"
                    onclick="Problems.filterCompany('${cId}')">
                    ${companyShort(cId)} <span class="company-bar__count">${cnt}</span>
                  </button>
                `).join('')}
              </div>
              <button class="company-bar__arrow" onclick="Problems.scrollCompanies(1)">\u203A</button>
            </div>
          </div>
        ` : '';
      }

      // ---- Update right sidebar (companies) ----
      const rightSidebar = document.getElementById('sidebar-right');
      if (rightSidebar) {
        rightSidebar.innerHTML = counts.sortedCompanies.length > 0 ? `
          <div class="sidebar__title">Companies</div>
          <input type="text" class="sidebar-right__search" placeholder="Search firms..."
            oninput="Problems.filterCompanySearch(this.value)">
          <div class="sidebar-right__companies">
            <button class="sidebar__cat-btn ${!activeCompany ? 'sidebar__cat-btn--active' : ''}"
              onclick="Problems.filterCompany(null)">
              <span>All Companies</span>
              <span class="sidebar__cat-count">${base.length}</span>
            </button>
            ${counts.sortedCompanies.map(([cId, cnt]) => `
              <button class="sidebar__cat-btn ${activeCompany === cId ? 'sidebar__cat-btn--active' : ''}"
                onclick="Problems.filterCompany('${cId}')">
                <span>${companyShort(cId)}</span>
                <span class="sidebar__cat-count">${cnt}</span>
              </button>
            `).join('')}
          </div>
        ` : '';
      }

      // ---- Update filter bar right side ----
      const pfRight = document.getElementById('pf-bar-right');
      if (pfRight) {
        pfRight.innerHTML = `
          <select class="pf-bar__sort" onchange="Problems.changeSort(this.value)">
            <option value="id-asc" ${currentSort.key==='id'&&currentSort.dir==='asc'?'selected':''}>ID \u2191</option>
            <option value="id-desc" ${currentSort.key==='id'&&currentSort.dir==='desc'?'selected':''}>ID \u2193</option>
            <option value="difficulty-asc" ${currentSort.key==='difficulty'&&currentSort.dir==='asc'?'selected':''}>Easy first</option>
            <option value="difficulty-desc" ${currentSort.key==='difficulty'&&currentSort.dir==='desc'?'selected':''}>Hard first</option>
            <option value="frequency-desc" ${currentSort.key==='frequency'?'selected':''}>Most asked</option>
            <option value="title-asc" ${currentSort.key==='title'?'selected':''}>Title A-Z</option>
          </select>
          <span class="pf-bar__count">${filtered.length} of ${base.length}</span>
          ${hasFilters ? '<button class="pf-bar__clear-all" onclick="Problems.clearAllFilters()">Clear all \u00D7</button>' : ''}
        `;
      }

      // Sync search input value without losing focus
      const searchEl = document.getElementById('search');
      if (searchEl && searchEl !== document.activeElement) {
        searchEl.value = searchQ;
      }

      // ---- Update table ----
      const start = (currentPage - 1) * PAGE_SIZE;
      const end = currentPage * PAGE_SIZE;
      const tableEl = document.getElementById('problems-table-container');
      if (tableEl) {
        tableEl.innerHTML = filtered.length > 0 ? `
          <table class="problem-table">
            <thead>
              <tr>
                <th class="th-status">Status</th>
                <th class="th-num" onclick="Problems.sort('id')">#${sortArrow('id')}</th>
                <th class="th-title" onclick="Problems.sort('title')">Title${sortArrow('title')}</th>
                <th class="th-cat" onclick="Problems.sort('category')">Category${sortArrow('category')}</th>
                <th class="th-diff" onclick="Problems.sort('difficulty')">Difficulty${sortArrow('difficulty')}</th>
                <th class="th-type" onclick="Problems.sort('type')">Type${sortArrow('type')}</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.slice(start, end).map(p => tableRow(p)).join('')}
            </tbody>
          </table>
        ` : '';
      }

      // ---- Pagination ----
      const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
      const loadMoreEl = document.getElementById('load-more-container');
      if (loadMoreEl) {
        loadMoreEl.innerHTML = totalPages > 1 ? renderPagination(currentPage, totalPages) : '';
      }

      // ---- Empty state ----
      const emptyEl = document.getElementById('empty-state-container');
      if (emptyEl) {
        if (filtered.length === 0) {
          emptyEl.innerHTML = `
            <div class="empty-state">
              <div class="empty-state__icon">\u{1F50D}</div>
              <div class="empty-state__title">No problems match these filters</div>
              <div class="empty-state__chips">
                ${activeCat ? `<button class="filter-chip" onclick="Problems.filterCat(null)">${getCatMeta(activeCat).name} \u00D7</button>` : ''}
                ${activeDiff ? `<button class="filter-chip" onclick="Problems.filterDiff(null)">${activeDiff} \u00D7</button>` : ''}
                ${activeType ? `<button class="filter-chip" onclick="Problems.filterType(null)">${formatType(activeType)} \u00D7</button>` : ''}
                ${activeTag ? `<button class="filter-chip" onclick="Problems.filterTag(null)">${formatTag(activeTag)} \u00D7</button>` : ''}
                ${activeCompany ? `<button class="filter-chip" onclick="Problems.filterCompany(null)">${companyShort(activeCompany)} \u00D7</button>` : ''}
                ${activeStatus ? `<button class="filter-chip" onclick="Problems.filterStatus(null)">${activeStatus} \u00D7</button>` : ''}
              </div>
              <button class="btn btn--secondary mt-4" onclick="Problems.clearAllFilters()">Clear all filters</button>
            </div>
          `;
        } else {
          emptyEl.innerHTML = '';
        }
      }

      // Remove updating class
      requestAnimationFrame(() => {
        if (main) main.classList.remove('problems-main--updating');
      });
    });
  }

  // ---- Table row ----
  function tableRow(p) {
    const catMeta = getCatMeta(p.category);
    const status = getStatus(p.id);
    const statusIcon = status === 'solved' ? '\u2705' : status === 'attempted' ? '\u{1F7E1}' : '';
    const isStub = p.status === 'incomplete';
    const isTitleOnly = p.status === 'title-only';
    const locked = isProblemLocked(p);
    const tagHtml = p.tags.slice(0, 3).map(t =>
      `<span class="td-tag">${formatTag(t)}</span>`
    ).join('');

    return `
      <tr class="${isStub || isTitleOnly ? 'problem-row--stub' : ''} ${locked ? 'problem-row--locked' : ''}">
        <td class="td-status">${locked ? '<span class="lock-icon">\u{1F512}</span>' : statusIcon}</td>
        <td class="td-num">${p.id}</td>
        <td>
          <a class="td-title-link" href="problems.html?id=${p.id}">${App.escapeHtml(p.title)}</a>
          ${isStub ? '<span class="stub-badge">draft</span>' : ''}
          ${isTitleOnly ? '<span class="stub-badge" style="background:#f59e0b22;color:#d97706">Coming Soon</span>' : ''}
          <div class="td-tags">${tagHtml}</div>
        </td>
        <td><span class="cat-pill" style="background:${catMeta.color}15;color:${catMeta.color}">${catMeta.icon} ${catMeta.name}</span></td>
        <td class="td-diff"><span class="diff-dot diff-${p.difficulty}"></span><span class="diff-label">${p.difficulty}</span></td>
        <td class="td-type">${formatType(p.type)}</td>
      </tr>
    `;
  }

  // ---- Pagination ----
  function goToPage(page) {
    const totalPages = Math.ceil(currentFiltered.length / PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    currentPage = page;

    // Re-render table with current page
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = currentPage * PAGE_SIZE;
    const tableEl = document.getElementById('problems-table-container');
    if (tableEl) {
      tableEl.innerHTML = currentFiltered.length > 0 ? `
        <table class="problem-table">
          <thead>
            <tr>
              <th class="th-status">Status</th>
              <th class="th-num" onclick="Problems.sort('id')">#${sortArrow('id')}</th>
              <th class="th-title" onclick="Problems.sort('title')">Title${sortArrow('title')}</th>
              <th class="th-cat" onclick="Problems.sort('category')">Category${sortArrow('category')}</th>
              <th class="th-diff" onclick="Problems.sort('difficulty')">Difficulty${sortArrow('difficulty')}</th>
              <th class="th-type" onclick="Problems.sort('type')">Type${sortArrow('type')}</th>
            </tr>
          </thead>
          <tbody>
            ${currentFiltered.slice(start, end).map(p => tableRow(p)).join('')}
          </tbody>
        </table>
      ` : '';
    }

    // Re-render pagination
    const loadMoreEl = document.getElementById('load-more-container');
    if (loadMoreEl) {
      loadMoreEl.innerHTML = totalPages > 1 ? renderPagination(currentPage, totalPages) : '';
    }

    // Scroll to top of table
    const main = document.getElementById('problems-main');
    if (main) main.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderPagination(current, total) {
    if (total <= 1) return '';

    const pages = [];
    const range = 2; // Show 2 pages on each side of current

    // Always show page 1
    pages.push(1);

    // Show ellipsis if needed
    if (current - range > 2) pages.push('...');

    // Show pages around current
    for (let i = Math.max(2, current - range); i <= Math.min(total - 1, current + range); i++) {
      pages.push(i);
    }

    // Show ellipsis if needed
    if (current + range < total - 1) pages.push('...');

    // Always show last page
    if (total > 1) pages.push(total);

    return `
      <div class="pagination">
        <button class="pagination__btn pagination__btn--arrow ${current <= 1 ? 'pagination__btn--disabled' : ''}"
          onclick="Problems.goToPage(${current - 1})" ${current <= 1 ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        ${pages.map(p => {
          if (p === '...') return '<span class="pagination__ellipsis">\u2026</span>';
          return `<button class="pagination__btn ${p === current ? 'pagination__btn--active' : ''}"
            onclick="Problems.goToPage(${p})">${p}</button>`;
        }).join('')}
        <button class="pagination__btn pagination__btn--arrow ${current >= total ? 'pagination__btn--disabled' : ''}"
          onclick="Problems.goToPage(${current + 1})" ${current >= total ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    `;
  }

  // Keep loadMore for backwards compat but redirect to goToPage
  function loadMore() { goToPage(currentPage + 1); }

  // ---- Similar Problems Engine ----
  // Uses pre-computed semantic graph when available, falls back to tag-based scoring
  function findSimilar(problem, count) {
    count = count || 5;

    // ---- Try pre-computed similarity graph first ----
    if (similarityGraph && similarityGraph.edges) {
      const edges = similarityGraph.edges[String(problem.id)];
      if (edges && edges.length > 0) {
        const results = [];
        for (const e of edges) {
          if (results.length >= count) break;
          const p = getById(e.id);
          if (p && p.status !== 'duplicate') {
            results.push({ problem: p, score: e.w, shared: [], reason: e.r || '' });
          }
        }
        if (results.length > 0) return results;
      }
    }

    // ---- Fallback: tag-based scoring ----
    const myTags = new Set(problem.tags);
    const myCat = problem.category;
    const myCompanies = new Set(problem.companies);

    const candidates = [];
    for (const p of allProblems) {
      if (p.id === problem.id || p.status === 'duplicate') continue;
      if (p.category !== myCat && myTags.size === 0) continue;

      let score = 0;
      const shared = [];
      for (const t of p.tags) {
        if (myTags.has(t)) { score++; shared.push(t); }
      }
      if (p.category === myCat) score += 0.5;
      if (p.difficulty === problem.difficulty) score += 0.3;
      for (const c of p.companies) {
        if (myCompanies.has(c)) { score += 0.2; break; }
      }
      if (score > 0) {
        candidates.push({ problem: p, score, shared, reason: '' });
        if (candidates.length > count * 4) {
          candidates.sort((a, b) => b.score - a.score);
          candidates.length = count * 2;
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, count);
  }

  // ---- Detail View ----
  function renderDetail(id) {
    const container = document.getElementById('content');
    if (!container) return;
    shellRendered = false;

    const numId = typeof id === 'number' ? id : parseInt(id, 10);
    const problem = getById(numId);
    if (!problem) {
      container.innerHTML = `
        <div class="container">
          <div class="empty-state">
            <div class="empty-state__icon">\u2753</div>
            <div class="empty-state__title">Problem not found</div>
            <a href="problems.html" class="btn btn--primary mt-4">Back to Problems</a>
          </div>
        </div>
      `;
      return;
    }

    const params = App.getParams();
    const isRandom = params.random === '1';
    const idx = allProblems.indexOf(problem);

    // Track random history for back/forward navigation
    if (isRandom) {
      if (randomHistory.length === 0 || randomHistory[randomHistoryIndex] !== problem.id) {
        // Navigated to a new random problem (not via back/forward)
        randomHistory = randomHistory.slice(0, randomHistoryIndex + 1);
        randomHistory.push(problem.id);
        randomHistoryIndex = randomHistory.length - 1;
      }
    }

    let prev, next, prevLabel, nextLabel;
    if (isRandom) {
      // Random mode: back goes to previous random, forward picks new random
      const hasPrev = randomHistoryIndex > 0;
      const hasForwardHistory = randomHistoryIndex < randomHistory.length - 1;

      if (hasPrev) {
        prev = getById(randomHistory[randomHistoryIndex - 1]) || null;
      } else {
        prev = null;
      }

      if (hasForwardHistory) {
        next = getById(randomHistory[randomHistoryIndex + 1]) || null;
      } else {
        // Pick a new random
        const eligible = allProblems.filter(p => p.id !== problem.id && p.status !== 'incomplete' && p.status !== 'title-only' && p.status !== 'duplicate');
        next = eligible.length > 0 ? eligible[Math.floor(Math.random() * eligible.length)] : null;
      }

      prevLabel = '\u2190 Back';
      nextLabel = 'Next Random \u2192';
    } else {
      prev = idx > 0 ? allProblems[idx - 1] : null;
      next = idx < allProblems.length - 1 ? allProblems[idx + 1] : null;
      prevLabel = '\u2190 Prev';
      nextLabel = 'Next \u2192';
    }

    const catMeta = getCatMeta(problem.category);
    const currentStatus = getStatus(problem.id);

    const companyHtml = problem.companies.map(c =>
      `<a class="company-tag" href="problems.html?company=${c}">${companyShort(c)}</a>`
    ).join('');

    const tagHtml = problem.tags.map(t =>
      `<a class="detail-tag" href="problems.html?tag=${encodeURIComponent(t)}">${formatTag(t)}</a>`
    ).join('');

    // Tier gating
    const locked = isProblemLocked(problem);
    const lockedOverlayHtml = `
      <div class="locked-overlay">
        <div class="locked-overlay__icon">\u{1F512}</div>
        <div class="locked-overlay__title">Pro Content</div>
        <div class="locked-overlay__desc">
          Upgrade to Pro to unlock hints, solutions, and intuition for all 1,090+ problems.
        </div>
        <button class="btn btn--primary btn--sm" onclick="Auth.showAccount()">Learn More</button>
      </div>
    `;

    // Hints
    const hintsHtml = problem.hints && problem.hints.length > 0
      ? (locked
        ? `<div class="detail-section">
            <div class="detail-section__label">Hints</div>
            ${lockedOverlayHtml}
          </div>`
        : `<div class="detail-section">
            <div class="detail-section__label">Hints</div>
            ${problem.hints.map((h, i) => `
              <div class="hint-item">
                <button class="collapsible-toggle" onclick="Problems.toggleHint(this)">
                  <span class="collapsible-toggle__arrow">\u25B6</span> Hint ${i + 1}
                </button>
                <div class="collapsible-content hint-content math-content">${MarkdownRender.render(h)}</div>
              </div>
            `).join('')}
          </div>`)
      : '';

    // Intuition
    const intuitionHtml = problem.intuition
      ? (locked
        ? `<div class="detail-section detail-section--intuition">
            ${lockedOverlayHtml}
          </div>`
        : `<div class="detail-section detail-section--intuition">
            <button class="collapsible-toggle collapsible-toggle--intuition" onclick="Problems.toggleIntuition(this)">
              <span class="collapsible-toggle__arrow">\u25B6</span> Intuition
            </button>
            <div class="collapsible-content intuition-content math-content">${MarkdownRender.render(problem.intuition)}</div>
          </div>`)
      : '';

    // Similar problems
    const similar = findSimilar(problem, 5);
    const similarHtml = similar.length > 0
      ? `<div class="detail-section detail-section--similar">
          <div class="detail-section__label">Similar Problems</div>
          <div class="similar-problems">
            ${similar.map(s => `
              <a class="similar-problem-card" href="problems.html?id=${s.problem.id}" target="_blank">
                <div class="similar-problem-card__top">
                  <span class="similar-problem-card__id">#${s.problem.id}</span>
                  <span class="badge badge--${s.problem.difficulty} badge--sm">${s.problem.difficulty}</span>
                </div>
                <div class="similar-problem-card__title">${App.escapeHtml(s.problem.title.length > 60 ? s.problem.title.substring(0, 57) + '...' : s.problem.title)}</div>
                <div class="similar-problem-card__tags">${s.reason || s.shared.slice(0, 3).map(t => formatTag(t)).join(', ')}</div>
              </a>
            `).join('')}
          </div>
        </div>`
      : '';

    // Discussion
    const discussionEntries = loadDiscussion(problem.id);

    // Saved notes
    const savedNotes = loadNotes(problem.id);

    container.innerHTML = `
      <div class="container">
        <div class="problem-detail__nav-bar">
          <a href="${getBackToListUrl()}" class="problem-nav-back">\u2190 All Problems</a>
          <div class="problem-detail__nav-arrows">
            ${prev
              ? (isRandom
                  ? `<a class="problem-nav-arrow" href="#" onclick="event.preventDefault();Problems.navigateRandom(${randomHistoryIndex - 1})" title="#${prev.id} ${App.escapeHtml(prev.title)}">${prevLabel}</a>`
                  : `<a class="problem-nav-arrow" href="problems.html?id=${prev.id}" title="#${prev.id} ${App.escapeHtml(prev.title)}">${prevLabel}</a>`)
              : `<span class="problem-nav-arrow problem-nav-arrow--disabled">${prevLabel}</span>`
            }
            ${next
              ? (isRandom
                  ? `<a class="problem-nav-arrow" href="#" onclick="event.preventDefault();Problems.navigateRandom(${randomHistoryIndex < randomHistory.length - 1 ? randomHistoryIndex + 1 : -1}, ${next.id})" title="#${next.id} ${App.escapeHtml(next.title)}">${nextLabel}</a>`
                  : `<a class="problem-nav-arrow" href="problems.html?id=${next.id}" title="#${next.id} ${App.escapeHtml(next.title)}">${nextLabel}</a>`)
              : `<span class="problem-nav-arrow problem-nav-arrow--disabled">${nextLabel}</span>`
            }
          </div>
        </div>

        <div class="problem-detail-layout">
          <!-- Left: Statement + Hints + Similar + Discussion -->
          <div class="problem-detail-left">
            <div class="problem-detail__header">
              <div class="problem-detail__meta-row">
                <span class="problem-detail__id-badge">#${problem.id}</span>
                <span class="badge badge--${problem.difficulty}">${problem.difficulty}</span>
                <span class="cat-pill" style="background:${catMeta.color}15;color:${catMeta.color}">${catMeta.icon} ${catMeta.name}</span>
                <span class="problem-detail__type-badge">${formatType(problem.type)}</span>
                ${problem.status === 'incomplete' ? '<span class="stub-badge">draft</span>' : ''}
                ${problem.status === 'title-only' ? '<span class="stub-badge" style="background:#f59e0b22;color:#d97706">Coming Soon</span>' : ''}
              </div>
              <h1 class="problem-detail__title">${App.escapeHtml(problem.title)}</h1>
              <div class="problem-detail__tags-row">${tagHtml}</div>
              ${companyHtml ? `<div class="problem-detail__companies">${companyHtml}</div>` : ''}
              <div class="problem-action-bar">
                <button class="pab__btn ${currentStatus === 'solved' ? 'pab__btn--active-green' : ''}"
                  onclick="Problems.markStatus(${problem.id}, '${currentStatus === 'solved' ? '' : 'solved'}')"
                  title="${currentStatus === 'solved' ? 'Undo solved' : 'Mark as solved'}">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>${currentStatus === 'solved' ? 'Solved' : 'Solved'}</span>
                </button>
                <button class="pab__btn ${currentStatus === 'attempted' ? 'pab__btn--active-yellow' : ''}"
                  onclick="Problems.markStatus(${problem.id}, '${currentStatus === 'attempted' ? '' : 'attempted'}')"
                  title="${currentStatus === 'attempted' ? 'Undo attempted' : 'Mark as attempted'}">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span>${currentStatus === 'attempted' ? 'Attempted' : 'Attempted'}</span>
                </button>
                <div class="pab__sep"></div>
                <button class="pab__icon-btn ${typeof Auth !== 'undefined' && Auth.isFavorited(problem.id) ? 'pab__icon-btn--liked' : ''}"
                  onclick="Problems.toggleFavorite(${problem.id})"
                  title="${typeof Auth !== 'undefined' && Auth.isFavorited(problem.id) ? 'Remove from favorites' : 'Add to favorites'}">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="${typeof Auth !== 'undefined' && Auth.isFavorited(problem.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                  </svg>
                </button>
                <button class="pab__icon-btn" onclick="Problems.addToCollection(${problem.id})" title="Save to list">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                  </svg>
                </button>
                <button class="pab__icon-btn" onclick="Problems.shareProblem(${problem.id})" title="Share">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                  </svg>
                </button>
                <button class="pab__icon-btn" onclick="Problems.flagProblem(${problem.id})" title="Report issue">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
                  </svg>
                </button>
              </div>
            </div>

            <div class="problem-detail__statement-card">
              <div class="problem-detail__statement-label">Problem Statement</div>
              <div class="problem-detail__statement math-content">
                ${locked
                  ? lockedOverlayHtml
                  : (problem.status === 'title-only'
                      ? '<p style="color:var(--text-muted);font-style:italic">This problem is sourced from real interviews. Full problem statement and solution coming soon.</p>'
                      : MarkdownRender.render(problem.statement))}
              </div>
            </div>

            ${hintsHtml}
            ${intuitionHtml}
            ${similarHtml}

            <!-- Discussion -->
            <div class="detail-section detail-section--discussion">
              <div class="detail-section__label">\u{1F4AC} Discussion Notes</div>
              <div id="discussion-entries">
                ${discussionEntries.length === 0
                  ? '<p class="discussion-empty">No discussion notes yet.</p>'
                  : discussionEntries.map(e => `
                      <div class="discussion-entry">
                        <div class="discussion-entry__text math-content">${MarkdownRender.render(e.text)}</div>
                        <div class="discussion-entry__meta">
                          <span class="discussion-entry__time">${new Date(e.timestamp).toLocaleDateString()}</span>
                          <button class="discussion-entry__delete" onclick="Problems.deleteDiscussionEntry(${problem.id}, ${e.timestamp})">\u2715</button>
                        </div>
                      </div>
                    `).join('')
                }
              </div>
              <div class="discussion-input-row">
                <textarea id="discussion-input" class="discussion-input" placeholder="Add a note to your discussion..." rows="2"></textarea>
                <button class="btn btn--sm btn--primary" onclick="Problems.addDiscussionEntry(${problem.id})">Add</button>
              </div>
            </div>
          </div>

          <!-- Right: Notes + Solution -->
          <div class="problem-detail-right">
            <div class="detail-section detail-section--notes">
              <div class="detail-section__label">\u{1F4DD} Your Notes</div>
              <textarea id="problem-notes" class="problem-notes__textarea"
                placeholder="Type your thoughts, approach, or scratch work here..."
                oninput="Problems.onNotesInput(${problem.id})">${App.escapeHtml(savedNotes)}</textarea>
            </div>

            ${locked
              ? `<div class="detail-section">${lockedOverlayHtml}</div>`
              : `<div class="detail-section">
                  <div class="solution-gate" id="solution-gate">
                    <div class="solution-gate__icon">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                      </svg>
                    </div>
                    <div class="solution-gate__title">View Solution</div>
                    <div class="solution-gate__desc">Try solving the problem yourself first. The solution will be revealed when you click below.</div>
                    <button class="solution-gate__btn" onclick="Problems.revealSolution()">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      Show Solution
                    </button>
                  </div>
                  <div class="solution-revealed" id="solution-revealed" style="display:none">
                    <button class="collapsible-toggle collapsible-toggle--solution collapsible-toggle--open" onclick="Problems.toggleSolution(this)">
                      <span class="collapsible-toggle__arrow">\u25BC</span> Solution
                    </button>
                    <div class="collapsible-content solution-content math-content collapsible-content--visible">
                      ${problem.solution ? MarkdownRender.render(problem.solution) : '<p class="no-solution">Solution not yet available for this problem.</p>'}
                    </div>
                  </div>
                </div>`
            }
          </div>
        </div>
      </div>
    `;

    KatexRender.render(container);
  }

  // ---- Filter helpers ----
  function filterCat(cat) {
    const p = App.getParams();
    p.category = cat; p.topic = null;
    App.setParams(p);
    if (!shellRendered) { renderShell(); }
    updateList(p);
  }

  function filterDiff(d) {
    const p = App.getParams();
    p.difficulty = p.difficulty === d ? null : d;
    App.setParams(p);
    if (!shellRendered) { renderShell(); }
    updateList(p);
  }

  function filterType(t) {
    const p = App.getParams();
    p.type = p.type === t ? null : t;
    App.setParams(p);
    if (!shellRendered) { renderShell(); }
    updateList(p);
  }

  function filterTag(tag) {
    const p = App.getParams();
    p.tag = p.tag === tag ? null : tag;
    App.setParams(p);
    if (!shellRendered) { renderShell(); }
    updateList(p);
  }

  function filterCompany(id) {
    const p = App.getParams();
    p.company = p.company === id ? null : id;
    App.setParams(p);
    if (!shellRendered) { renderShell(); }
    updateList(p);
  }

  function filterStatus(status) {
    const p = App.getParams();
    p.status = p.status === status ? null : status;
    App.setParams(p);
    if (!shellRendered) { renderShell(); }
    updateList(p);
  }

  function clearAllFilters() {
    // Preserve list param if active (from Explore page)
    const newParams = activeListId ? { list: activeListId } : {};
    App.setParams(newParams);
    if (!shellRendered) { renderShell(); }
    updateList(newParams);
  }

  // ---- Company bar helpers ----
  function scrollCompanies(dir) {
    const inner = document.getElementById('company-pills');
    if (inner) inner.scrollBy({ left: dir * 200, behavior: 'smooth' });
  }

  function filterCompanySearch(query) {
    const q = query.toLowerCase();
    // Search both inline pills and right sidebar buttons
    document.querySelectorAll('.company-bar__pill, .sidebar-right__companies .sidebar__cat-btn').forEach(btn => {
      btn.style.display = btn.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  }

  // ---- Random problem ----
  function randomProblem() {
    const pool = currentFiltered.length > 0 ? currentFiltered : allProblems;
    const eligible = pool.filter(p => p.status !== 'incomplete' && p.status !== 'title-only' && p.status !== 'duplicate');
    if (eligible.length === 0) return;

    // Build/rebuild the shuffled queue if empty or from a different pool
    if (randomQueue.length === 0 || randomQueueIndex >= randomQueue.length - 1) {
      randomQueue = [...eligible];
      // Fisher-Yates shuffle
      for (let i = randomQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [randomQueue[i], randomQueue[j]] = [randomQueue[j], randomQueue[i]];
      }
      randomQueueIndex = 0;
    } else {
      randomQueueIndex++;
    }

    const pick = randomQueue[randomQueueIndex];
    if (pick) window.location.href = 'problems.html?id=' + pick.id + '&random=1';
  }

  // ---- Stub toggle ----
  function toggleStubs() {
    hideStubs = !hideStubs;
    try { localStorage.setItem('qr-prep-hide-stubs', hideStubs.toString()); }
    catch (e) { /* ignore */ }
    updateList(App.getParams());
  }

  // ---- Tag cloud toggle ----
  function toggleTagCloud() {
    const el = document.getElementById('tag-expanded');
    const btn = document.getElementById('tag-expand');
    if (!el || !btn) return;
    if (el.style.display === 'none') {
      el.style.display = 'flex';
      btn.textContent = 'Show less';
    } else {
      el.style.display = 'none';
      const count = el.querySelectorAll('.tag-cloud__pill').length;
      btn.textContent = '+' + count + ' more';
    }
  }

  // ---- Toggle helpers ----
  function toggleCollapsible(btn) {
    btn.classList.toggle('collapsible-toggle--open');
    const content = btn.nextElementSibling;
    content.classList.toggle('collapsible-content--visible');
    btn.querySelector('.collapsible-toggle__arrow').textContent =
      content.classList.contains('collapsible-content--visible') ? '\u25BC' : '\u25B6';
    KatexRender.render(content);
  }

  function revealSolution() {
    const gate = document.getElementById('solution-gate');
    const revealed = document.getElementById('solution-revealed');
    if (gate) gate.style.display = 'none';
    if (revealed) {
      revealed.style.display = 'block';
      KatexRender.render(revealed);
    }
  }

  function toggleSolution(btn) { toggleCollapsible(btn); }
  function toggleHint(btn) { toggleCollapsible(btn); }
  function toggleIntuition(btn) { toggleCollapsible(btn); }

  // ---- Sort handler ----
  function sort(key) {
    if (currentSort.key === key) {
      currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      currentSort = { key, dir: 'asc' };
    }
    updateList(App.getParams());
  }

  function changeSort(value) {
    const parts = value.split('-');
    const key = parts.slice(0, -1).join('-');
    const dir = parts[parts.length - 1];
    currentSort = { key, dir };
    updateList(App.getParams());
  }

  // ---- Random navigation with history ----
  function navigateRandom(histIdx, newId) {
    if (histIdx >= 0 && histIdx < randomHistory.length) {
      randomHistoryIndex = histIdx;
      const targetId = randomHistory[histIdx];
      App.setParams({ id: targetId, random: '1' });
      renderDetailLazy(targetId);
      window.scrollTo(0, 0);
    } else if (newId) {
      randomHistory = randomHistory.slice(0, randomHistoryIndex + 1);
      randomHistory.push(newId);
      randomHistoryIndex = randomHistory.length - 1;
      App.setParams({ id: newId, random: '1' });
      renderDetailLazy(newId);
      window.scrollTo(0, 0);
    }
  }

  // ---- Share problem ----
  function shareProblem(problemId) {
    const url = window.location.origin + window.location.pathname + '?id=' + problemId;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        showToast('Link copied to clipboard!');
      }).catch(() => {
        showToast('Could not copy link');
      });
    } else {
      // Fallback
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      showToast('Link copied to clipboard!');
    }
  }

  // ---- Flag problem ----
  function flagProblem(problemId) {
    showToast('Thanks for the feedback! Issue reported for #' + problemId);
  }

  // ---- Toast notification ----
  function showToast(message, type) {
    const existing = document.querySelector('.qr-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'qr-toast' + (type === 'xp' ? ' qr-toast--xp' : '');
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => { toast.classList.add('qr-toast--show'); });
    setTimeout(() => {
      toast.classList.remove('qr-toast--show');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ---- Favorite toggle ----
  function toggleFavorite(problemId) {
    console.log('[Problems] toggleFavorite called:', problemId);
    if (typeof Auth === 'undefined' || !Auth.isLoggedIn()) {
      if (typeof Auth !== 'undefined') Auth.showAuthModal();
      return;
    }
    const wasFavorited = Auth.isFavorited(problemId);
    const isFav = !wasFavorited; // Optimistic toggle

    // ===== Instant UI feedback =====
    const heartBtn = document.querySelector('.pab__icon-btn--liked, .pab__icon-btn[title*="favorite"]');
    if (heartBtn) {
      if (isFav) {
        heartBtn.classList.add('pab__icon-btn--liked');
        heartBtn.title = 'Remove from favorites';
        try { heartBtn.querySelector('svg').setAttribute('fill', 'currentColor'); } catch(e) {}
      } else {
        heartBtn.classList.remove('pab__icon-btn--liked');
        heartBtn.title = 'Add to favorites';
        try { heartBtn.querySelector('svg').setAttribute('fill', 'none'); } catch(e) {}
      }
      heartBtn.classList.add('pab__icon-btn--anim-heart');
      setTimeout(() => heartBtn.classList.remove('pab__icon-btn--anim-heart'), 500);
    }

    showToast(isFav ? '\u2764\uFE0F Added to favorites' : 'Removed from favorites');

    // ===== Persist in background =====
    Auth.toggleFavorite(problemId).catch(err => {
      console.error('[Problems] toggleFavorite failed:', err);
    });
  }

  // ---- Add to collection ----
  function addToCollection(problemId) {
    if (typeof Auth === 'undefined' || !Auth.isLoggedIn()) {
      if (typeof Auth !== 'undefined') Auth.showAuthModal();
      return;
    }
    // Animate bookmark button
    const bookmarkBtns = document.querySelectorAll('.pab__icon-btn[title="Save to list"]');
    bookmarkBtns.forEach(btn => {
      btn.classList.add('pab__icon-btn--anim-bookmark');
      setTimeout(() => btn.classList.remove('pab__icon-btn--anim-bookmark'), 500);
    });
    if (typeof Collections !== 'undefined') {
      Collections.showModal(problemId);
    }
  }

  // ---- Favorites filter ----
  function filterFavorites() {
    const p = App.getParams();
    p.filter = p.filter === 'favorites' ? null : 'favorites';
    App.setParams(p);
    if (!shellRendered) renderShell();
    updateList(p);
  }

  return {
    init, toggleSolution, toggleHint, toggleIntuition,
    filterCat, filterDiff, filterType, filterTag, filterCompany,
    filterStatus, clearAllFilters, filterCompanySearch, scrollCompanies,
    toggleTagCloud, toggleStubs, sort, changeSort,
    onNotesInput, loadMore, goToPage, randomProblem, markStatus,
    addDiscussionEntry, deleteDiscussionEntry,
    toggleFavorite, addToCollection, filterFavorites,
    navigateRandom, shareProblem, flagProblem, revealSolution, showToast,
  };
})();
