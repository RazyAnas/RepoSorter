// GitHub Repo Sorter - Content Script
// Injects sorting controls and handles sorting logic on GitHub repo file pages

(function () {
  'use strict';

  const SORT_KEY = 'grs_sort_state';
  let currentSort = { by: 'default', dir: 'asc' };
  let originalOrder = null;
  let observer = null;
  let controlsInjected = false;

  // ── Detect if this is a repository file listing page ──────────────────────
  function isRepoFilePage() {
    const path = window.location.pathname;
    // Matches: /user/repo or /user/repo/tree/branch or /user/repo/tree/branch/path
    return /^\/[^/]+\/[^/]+(?:\/tree\/[^/]+(?:\/.*)?)?$/.test(path);
  }

  function getFileTable() {
    // New GitHub UI (react-based)
    return (
      document.querySelector('[aria-labelledby="folders-and-files"]') ||
      document.querySelector('.js-navigation-container.js-active-navigation-container') ||
      document.querySelector('table.files') ||
      document.querySelector('[data-testid="file-list"]') ||
      document.querySelector('.Details-content--shown table') ||
      null
    );
  }

  function getFileRows() {
    const table = getFileTable();
    if (!table) return [];

    // New GitHub UI: each row is a <tr> or a box with file info
    let rows = Array.from(table.querySelectorAll('tr[class*="react-directory-row"]'));
    if (!rows.length) rows = Array.from(table.querySelectorAll('tr.js-navigation-item'));
    if (!rows.length) rows = Array.from(table.querySelectorAll('tr[data-testid]'));
    // Fallback: all tr children
    if (!rows.length) {
      const tbody = table.querySelector('tbody') || table;
      rows = Array.from(tbody.querySelectorAll('tr')).filter(r => r.querySelector('a'));
    }
    return rows;
  }

  // ── Parse data from a row ─────────────────────────────────────────────────
  function parseRow(row) {
    // Name
    const nameEl =
      row.querySelector('[data-testid="file-name"]') ||
      row.querySelector('.js-navigation-open') ||
      row.querySelector('a[title]') ||
      row.querySelector('td:nth-child(1) a');
    const name = nameEl ? nameEl.textContent.trim() : '';

    // Type (dir vs file) — icons / aria
    const isDir =
      row.querySelector('[aria-label*="Directory"]') !== null ||
      row.querySelector('[aria-label*="directory"]') !== null ||
      row.querySelector('svg[aria-label*="Directory"]') !== null ||
      row.querySelector('[data-testid="directory-icon"]') !== null ||
      row.querySelector('.octicon-file-directory') !== null ||
      row.classList.contains('js-navigation-item') && row.querySelector('[aria-label="Directory"]') !== null;

    // Commit message / description
    const msgEl =
      row.querySelector('[data-testid="latest-commit-message"]') ||
      row.querySelector('td.message span') ||
      row.querySelector('td:nth-child(2)');
    const message = msgEl ? msgEl.textContent.trim() : '';

    // Date: look for <time> element
    const timeEl = row.querySelector('time') || row.querySelector('[datetime]');
    const dateRaw = timeEl ? (timeEl.getAttribute('datetime') || timeEl.getAttribute('title') || timeEl.textContent.trim()) : '';
    const date = dateRaw ? new Date(dateRaw) : new Date(0);

    // Size: GitHub doesn't show file sizes in listing by default — we'll extract from aria or data attrs
    const sizeEl = row.querySelector('[data-testid="file-size"]') || row.querySelector('td.size');
    const sizeRaw = sizeEl ? sizeEl.textContent.trim() : '';
    const sizeBytes = parseSize(sizeRaw);

    return { name, isDir, message, date, sizeBytes, el: row };
  }

  function parseSize(str) {
    if (!str) return 0;
    const m = str.match(/([\d.]+)\s*(B|KB|MB|GB|Bytes?|Kilobytes?|Megabytes?)?/i);
    if (!m) return 0;
    const num = parseFloat(m[1]);
    const unit = (m[2] || 'B').toUpperCase();
    if (unit.startsWith('K')) return num * 1024;
    if (unit.startsWith('M')) return num * 1024 * 1024;
    if (unit.startsWith('G')) return num * 1024 * 1024 * 1024;
    return num;
  }

  // ── Sort ─────────────────────────────────────────────────────────────────
  function sortRows(rows, by, dir) {
    const mult = dir === 'asc' ? 1 : -1;

    return [...rows].sort((a, b) => {
      const da = parseRow(a);
      const db = parseRow(b);

      // Directories always first
      if (da.isDir !== db.isDir) return da.isDir ? -1 : 1;

      let cmp = 0;
      switch (by) {
        case 'name':
          cmp = da.name.localeCompare(db.name, undefined, { sensitivity: 'base', numeric: true });
          break;
        case 'date':
          cmp = da.date - db.date;
          break;
        case 'size':
          cmp = da.sizeBytes - db.sizeBytes;
          break;
        case 'type': {
          const extA = da.name.split('.').pop().toLowerCase();
          const extB = db.name.split('.').pop().toLowerCase();
          cmp = extA.localeCompare(extB);
          if (cmp === 0) cmp = da.name.localeCompare(db.name);
          break;
        }
        case 'message':
          cmp = da.message.localeCompare(db.message);
          break;
        default:
          return 0;
      }
      return cmp * mult;
    });
  }

  function applySort(by, dir) {
    if (by === 'default') {
      restoreOriginal();
      return;
    }

    const table = getFileTable();
    const rows = getFileRows();
    if (!table || !rows.length) return;

    // Save original order once
    if (!originalOrder) {
      originalOrder = rows.map(r => r.cloneNode(true));
    }

    const sorted = sortRows(rows, by, dir);
    const parent = rows[0].parentNode;

    // Re-insert in sorted order
    sorted.forEach(row => parent.appendChild(row));

    // Highlight sorted column indicator in our UI
    updateSortIndicators(by, dir);
  }

  function restoreOriginal() {
    if (!originalOrder) return;
    const rows = getFileRows();
    if (!rows.length) return;
    const parent = rows[0].parentNode;
    // Remove current rows
    rows.forEach(r => r.remove());
    // Re-insert originals
    originalOrder.forEach(r => parent.appendChild(r));
    originalOrder = null;
    updateSortIndicators('default', 'asc');
  }

  // ── UI Injection ─────────────────────────────────────────────────────────
  function injectControls() {
    if (document.getElementById('grs-controls')) return;

    const target =
      document.querySelector('[aria-label="Files"]') ||
      document.querySelector('.Details-content--shown') ||
      document.querySelector('.repository-content') ||
      document.querySelector('#repo-content-pjax-container') ||
      document.querySelector('#repo-content-turbo-frame');

    if (!target) return;

    const bar = document.createElement('div');
    bar.id = 'grs-controls';
    bar.innerHTML = `
      <style>
        #grs-controls {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          background: var(--color-canvas-subtle, #f6f8fa);
          border: 1px solid var(--color-border-default, #d0d7de);
          border-radius: 6px;
          margin-bottom: 8px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          font-size: 12px;
          flex-wrap: wrap;
        }
        #grs-controls .grs-label {
          font-weight: 600;
          color: var(--color-fg-muted, #656d76);
          margin-right: 4px;
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        #grs-controls .grs-label svg {
          width: 14px;
          height: 14px;
          fill: none;
          stroke: currentColor;
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        #grs-controls .grs-btns {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
        }
        #grs-controls button {
          padding: 3px 10px;
          border-radius: 20px;
          border: 1px solid var(--color-border-default, #d0d7de);
          background: var(--color-canvas-default, #fff);
          color: var(--color-fg-default, #1f2328);
          font-size: 11.5px;
          cursor: pointer;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
          white-space: nowrap;
        }
        #grs-controls button:hover {
          background: var(--color-accent-subtle, #ddf4ff);
          border-color: var(--color-accent-muted, #54aeff);
          color: var(--color-accent-fg, #0969da);
        }
        #grs-controls button.grs-active {
          background: var(--color-accent-emphasis, #0969da);
          border-color: var(--color-accent-emphasis, #0969da);
          color: #fff;
        }
        #grs-controls .grs-dir-toggle {
          display: flex;
          align-items: center;
          gap: 5px;
          margin-left: 4px;
          color: var(--color-fg-muted, #656d76);
          font-size: 11.5px;
          cursor: pointer;
          white-space: nowrap;
        }
        #grs-controls .grs-dir-toggle input {
          accent-color: var(--color-accent-emphasis, #0969da);
        }
        #grs-controls .grs-sep {
          width: 1px;
          height: 18px;
          background: var(--color-border-default, #d0d7de);
          margin: 0 4px;
        }
        #grs-controls .grs-reset {
          margin-left: auto;
          opacity: 0.7;
        }
        #grs-controls .grs-reset:hover {
          opacity: 1;
          background: var(--color-danger-subtle, #fff0ee);
          border-color: var(--color-danger-muted, #ffaba8);
          color: var(--color-danger-fg, #d1242f);
        }
      </style>

      <span class="grs-label">
        <svg viewBox="0 0 24 24"><path d="M3 6h18M7 12h10M11 18h2"/></svg>
        Sort by
      </span>
      <div class="grs-btns">
        <button data-sort="name" title="Sort by file/folder name">
          <span>Name</span><span class="grs-arrow"></span>
        </button>
        <button data-sort="date" title="Sort by last commit date">
          <span>Date Modified</span><span class="grs-arrow"></span>
        </button>
        <button data-sort="size" title="Sort by file size (folders first)">
          <span>Size</span><span class="grs-arrow"></span>
        </button>
        <button data-sort="type" title="Sort by file extension/type">
          <span>Type</span><span class="grs-arrow"></span>
        </button>
        <button data-sort="message" title="Sort by last commit message">
          <span>Commit Msg</span><span class="grs-arrow"></span>
        </button>
      </div>
      <div class="grs-sep"></div>
      <label class="grs-dir-toggle" title="Toggle sort direction">
        <input type="checkbox" id="grs-asc" checked>
        Ascending
      </label>
      <button class="grs-reset" data-sort="default" title="Restore GitHub's default order">↺ Reset</button>
    `;

    // Insert before the file table container
    const tableWrapper =
      target.querySelector('[aria-label="Files"]') ||
      target.querySelector('.js-details-container') ||
      target.firstElementChild;

    const fileSection =
      document.querySelector('div[data-testid="repository-section"]') ||
      document.querySelector('.Box.mb-3') ||
      document.querySelector('react-app') ||
      tableWrapper;

    if (fileSection && fileSection.parentNode) {
      fileSection.parentNode.insertBefore(bar, fileSection);
    } else {
      target.prepend(bar);
    }

    controlsInjected = true;

    // Event listeners
    bar.querySelectorAll('button[data-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        const by = btn.dataset.sort;
        if (by === 'default') {
          currentSort = { by: 'default', dir: 'asc' };
          document.getElementById('grs-asc').checked = true;
        } else if (currentSort.by === by) {
          currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
          document.getElementById('grs-asc').checked = currentSort.dir === 'asc';
        } else {
          currentSort = { by, dir: document.getElementById('grs-asc').checked ? 'asc' : 'desc' };
        }
        applySort(currentSort.by, currentSort.dir);
      });
    });

    document.getElementById('grs-asc').addEventListener('change', e => {
      currentSort.dir = e.target.checked ? 'asc' : 'desc';
      if (currentSort.by !== 'default') applySort(currentSort.by, currentSort.dir);
    });
  }

  function updateSortIndicators(by, dir) {
    const bar = document.getElementById('grs-controls');
    if (!bar) return;
    bar.querySelectorAll('button[data-sort]').forEach(btn => {
      const arrow = btn.querySelector('.grs-arrow');
      if (btn.dataset.sort === by && by !== 'default') {
        btn.classList.add('grs-active');
        if (arrow) arrow.textContent = dir === 'asc' ? ' ↑' : ' ↓';
      } else {
        btn.classList.remove('grs-active');
        if (arrow) arrow.textContent = '';
      }
    });
    const ascCb = document.getElementById('grs-asc');
    if (ascCb) ascCb.checked = dir === 'asc';
  }

  // ── Init & Observe ────────────────────────────────────────────────────────
  function tryInit() {
    if (!isRepoFilePage()) return;

    const rows = getFileRows();
    if (!rows.length) return;

    if (!controlsInjected) injectControls();
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      if (!isRepoFilePage()) {
        cleanup();
        return;
      }
      controlsInjected = document.getElementById('grs-controls') !== null;
      tryInit();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function cleanup() {
    const ctrl = document.getElementById('grs-controls');
    if (ctrl) ctrl.remove();
    controlsInjected = false;
    originalOrder = null;
    currentSort = { by: 'default', dir: 'asc' };
  }

  // Handle GitHub's turbo/pjax navigation
  document.addEventListener('turbo:load', () => {
    cleanup();
    setTimeout(tryInit, 400);
  });
  document.addEventListener('pjax:end', () => {
    cleanup();
    setTimeout(tryInit, 400);
  });

  // Initial load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(tryInit, 600);
      startObserver();
    });
  } else {
    setTimeout(tryInit, 600);
    startObserver();
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'sort') {
      currentSort = { by: msg.by, dir: msg.dir };
      if (!isRepoFilePage()) {
        sendResponse({ ok: false, reason: 'Not a repo file page' });
        return;
      }
      const rows = getFileRows();
      if (!rows.length) {
        sendResponse({ ok: false, reason: 'No file rows found' });
        return;
      }
      if (!controlsInjected) injectControls();
      applySort(msg.by, msg.dir);
      sendResponse({ ok: true });
    }
    if (msg.action === 'status') {
      sendResponse({
        isRepoPage: isRepoFilePage(),
        hasRows: getFileRows().length > 0,
        currentSort,
      });
    }
    return true;
  });
})();
