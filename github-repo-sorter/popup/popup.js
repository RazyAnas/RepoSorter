// GitHub Repo Sorter — Popup Script

let selectedBy = null;
let selectedDir = 'asc';
let isActivePage = false;

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const mainBody = document.getElementById('mainBody');
const activeView = document.getElementById('activeView');
const disabledView = document.getElementById('disabledView');
const applyBtn = document.getElementById('applyBtn');
const resetBtn = document.getElementById('resetBtn');
const toast = document.getElementById('toast');
const sortBtns = document.querySelectorAll('.sort-btn');
const dirBtns = document.querySelectorAll('.dir-btn');

// ── Status check ────────────────────────────────────────────────────────────
async function checkStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.startsWith('https://github.com')) {
      setStatus(false, 'Open a GitHub page first');
      return;
    }

    chrome.tabs.sendMessage(tab.id, { action: 'status' }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        // content script not yet ready
        setStatus(false, 'Navigate to a GitHub repo');
        return;
      }
      if (resp.isRepoPage && resp.hasRows) {
        setStatus(true, 'Ready — repo file page detected');
        if (resp.currentSort && resp.currentSort.by !== 'default') {
          selectedBy = resp.currentSort.by;
          selectedDir = resp.currentSort.dir;
          updateUI();
        }
      } else if (resp.isRepoPage) {
        setStatus(false, 'No file table found on this page');
      } else {
        setStatus(false, 'Not a repo file listing page');
      }
    });
  } catch (e) {
    setStatus(false, 'Error checking page');
  }
}

function setStatus(active, msg) {
  isActivePage = active;
  statusDot.className = 'status-dot ' + (active ? 'active' : 'inactive');
  statusText.textContent = msg;
  activeView.style.display = active ? '' : 'none';
  disabledView.className = 'disabled-overlay' + (active ? '' : ' show');
}

// ── UI state ─────────────────────────────────────────────────────────────────
function updateUI() {
  sortBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.by === selectedBy);
  });
  dirBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.dir === selectedDir);
  });
  applyBtn.disabled = !selectedBy;
}

// ── Sort button clicks ────────────────────────────────────────────────────────
sortBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    selectedBy = btn.dataset.by;
    updateUI();
  });
});

dirBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    selectedDir = btn.dataset.dir;
    updateUI();
  });
});

// ── Apply ────────────────────────────────────────────────────────────────────
applyBtn.addEventListener('click', async () => {
  if (!selectedBy) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'sort', by: selectedBy, dir: selectedDir }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        showToast('error', 'Could not reach the page. Refresh and try again.');
        return;
      }
      if (resp.ok) {
        showToast('ok', `Sorted by ${selectedBy} (${selectedDir === 'asc' ? 'ascending' : 'descending'})`);
      } else {
        showToast('error', resp.reason || 'Sort failed — try refreshing.');
      }
    });
  } catch (e) {
    showToast('error', 'Unexpected error. Refresh the page.');
  }
});

// ── Reset ─────────────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'sort', by: 'default', dir: 'asc' }, () => {
      selectedBy = null;
      selectedDir = 'asc';
      updateUI();
      showToast('ok', 'Restored GitHub default order');
    });
  } catch (e) {
    showToast('error', 'Reset failed. Try refreshing the page.');
  }
});

// ── Toast helper ──────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(type, msg) {
  toast.textContent = (type === 'ok' ? '✓ ' : '✕ ') + msg;
  toast.className = 'toast show ' + (type === 'ok' ? 'ok' : 'err');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3000);
}

// ── Init ──────────────────────────────────────────────────────────────────────
checkStatus();
