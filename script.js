const state = {
  count: 0,
  capacity: 1,
  history: [],
  resetTime: '00:00',
  lastReset: null
};

function loadState() {
  const saved = localStorage.getItem('personCounterState');
  if (saved) {
    Object.assign(state, JSON.parse(saved));
  }
}

function saveState() {
  localStorage.setItem('personCounterState', JSON.stringify(state));
}

function updateDisplay() {
  document.getElementById('counter').textContent = state.count;
  document.getElementById('capacityDisplay').textContent = state.capacity;
  const available = state.capacity - state.count;
  document.getElementById('availableDisplay').textContent = available >= 0 ? available : 0;
  updateIndicator();
}

function updateIndicator() {
  const body = document.body;
  body.classList.remove('bg-green-100', 'bg-yellow-100', 'bg-red-100');
  const ratio = state.count / state.capacity;
  if (ratio < 0.8) body.classList.add('bg-green-100');
  else if (ratio < 1) body.classList.add('bg-yellow-100');
  else body.classList.add('bg-red-100');
}

function logEvent(delta) {
  const total = state.count;
  state.history.push({ timestamp: new Date().toISOString(), delta, total });
}

function register(delta) {
  const newCount = state.count + delta;
  if (newCount < 0) return;
  state.count = newCount;
  logEvent(delta);
  saveState();
  updateDisplay();
}

function undoLast() {
  const last = state.history.pop();
  if (!last) return;
  if (state.history.length) {
    state.count = state.history[state.history.length - 1].total;
  } else {
    state.count = 0;
  }
  saveState();
  updateDisplay();
  if (!document.getElementById('historyModal').classList.contains('hidden')) {
    renderHistory();
  }
}

function renderHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '';
  const fromVal = document.getElementById('historyFrom').value;
  const toVal = document.getElementById('historyTo').value;
  const from = fromVal ? new Date(fromVal) : null;
  const to = toVal ? new Date(toVal) : null;
  state.history
    .filter(e => (!from || new Date(e.timestamp) >= from) && (!to || new Date(e.timestamp) <= to))
    .forEach(e => {
      const li = document.createElement('li');
      const time = new Date(e.timestamp).toLocaleString();
      li.textContent = `${time} ${e.delta > 0 ? '+1' : '-1'} => ${e.total}`;
      list.appendChild(li);
    });
}

function showHistory() {
  renderHistory();
  document.getElementById('historyModal').classList.remove('hidden');
}

function showSettings() {
  document.getElementById('capacityInput').value = state.capacity;
  document.getElementById('resetTimeInput').value = state.resetTime;
  document.getElementById('settingsModal').classList.remove('hidden');
}

function saveSettings() {
  const cap = parseInt(document.getElementById('capacityInput').value, 10);
  state.capacity = isNaN(cap) || cap < 1 ? 1 : cap;
  const rt = document.getElementById('resetTimeInput').value;
  state.resetTime = rt || '00:00';
  saveState();
  updateDisplay();
  document.getElementById('settingsModal').classList.add('hidden');
}

function performDailyResetIfNeeded() {
  const [h, m] = state.resetTime.split(':').map(Number);
  const now = new Date();
  const resetToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  const lastReset = state.lastReset ? new Date(state.lastReset) : new Date(0);
  if (now >= resetToday && lastReset < resetToday) {
    state.count = 0;
    state.lastReset = resetToday.toISOString();
    saveState();
    updateDisplay();
  }
}

// Event listeners
window.addEventListener('load', () => {
  loadState();
  performDailyResetIfNeeded();
  updateDisplay();

  document.getElementById('btnIn').addEventListener('click', () => {
    performDailyResetIfNeeded();
    register(1);
  });
  document.getElementById('btnOut').addEventListener('click', () => {
    performDailyResetIfNeeded();
    if (state.count > 0) register(-1);
  });
  document.getElementById('btnUndo').addEventListener('click', undoLast);
  document.getElementById('btnHistory').addEventListener('click', showHistory);
  document.getElementById('historyClose').addEventListener('click', () => document.getElementById('historyModal').classList.add('hidden'));
  document.getElementById('historyFilter').addEventListener('click', renderHistory);
  document.getElementById('btnSettings').addEventListener('click', showSettings);
  document.getElementById('settingsSave').addEventListener('click', saveSettings);
  document.getElementById('settingsClose').addEventListener('click', () => document.getElementById('settingsModal').classList.add('hidden'));
});
