const state = {
  count: 0,
  capacity: 1,
  history: [],
  resetTime: '00:00',
  lastReset: null,
  role: 'guard',
  theme: 'light',
  reports: [],
  daily: { in: 0, out: 0, peak: 0, peakTime: null }
};

function loadState() {
  const saved = localStorage.getItem('personCounterState');
  if (saved) {
    Object.assign(state, JSON.parse(saved));
  }
  state.role = state.role || 'guard';
  state.theme = state.theme || 'light';
  state.reports = state.reports || [];
  state.daily = state.daily || { in: 0, out: 0, peak: 0, peakTime: null };
}

function saveState() {
  localStorage.setItem('personCounterState', JSON.stringify(state));
}

function applyTheme() {
  document.documentElement.classList.toggle('dark', state.theme === 'dark');
}

function applyRole() {
  document.getElementById('btnReport').classList.toggle('hidden', state.role !== 'admin');
  document.getElementById('forecastDisplay').classList.toggle('hidden', state.role !== 'admin');
}

function updateDisplay() {
  document.getElementById('counter').textContent = state.count;
  document.getElementById('capacityDisplay').textContent = state.capacity;
  const available = state.capacity - state.count;
  document.getElementById('availableDisplay').textContent = available >= 0 ? available : 0;
  updateStatusBadge();
  updateForecast();
}

function updateStatusBadge() {
  const badge = document.getElementById('statusBadge');
  badge.className = 'text-sm px-2 py-1 rounded-full';
  const ratio = state.capacity ? state.count / state.capacity : 0;
  if (ratio < 0.8) {
    badge.classList.add('bg-green-200', 'text-green-800');
    badge.textContent = 'God';
  } else if (ratio < 1) {
    badge.classList.add('bg-yellow-200', 'text-yellow-800');
    badge.textContent = 'Nesten fullt';
  } else {
    badge.classList.add('bg-red-200', 'text-red-800');
    badge.textContent = 'Fullt';
  }
}

function logEvent(delta) {
  const total = state.count;
  state.history.push({ timestamp: new Date().toISOString(), delta, total });
  if (delta > 0) state.daily.in += delta;
  else state.daily.out += -delta;
  if (total > state.daily.peak) {
    state.daily.peak = total;
    state.daily.peakTime = new Date().toISOString();
  }
}

function register(delta) {
  const newCount = state.count + delta;
  if (newCount < 0) return;
  state.count = newCount;
  logEvent(delta);
  saveState();
  updateDisplay();
}

function recomputeDailyStats() {
  const today = new Date().toISOString().split('T')[0];
  state.daily = { in: 0, out: 0, peak: 0, peakTime: null };
  state.history.forEach(e => {
    if (e.timestamp.split('T')[0] === today) {
      if (e.delta > 0) state.daily.in += e.delta;
      else state.daily.out += -e.delta;
      if (e.total > state.daily.peak) {
        state.daily.peak = e.total;
        state.daily.peakTime = e.timestamp;
      }
    }
  });
}

function undoLast() {
  const last = state.history.pop();
  if (!last) return;
  if (state.history.length) {
    state.count = state.history[state.history.length - 1].total;
  } else {
    state.count = 0;
  }
  recomputeDailyStats();
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

function renderReports() {
  const tbody = document.getElementById('reportTable');
  tbody.innerHTML = '';
  state.reports.forEach(r => {
    const tr = document.createElement('tr');
    const peakTime = r.peakTime ? new Date(r.peakTime).toLocaleTimeString() : '';
    tr.innerHTML = `<td>${r.date}</td><td>${r.inn}</td><td>${r.ut}</td><td>${r.peak}</td><td>${peakTime}</td>`;
    tbody.appendChild(tr);
  });
}

function showReports() {
  renderReports();
  document.getElementById('reportModal').classList.remove('hidden');
}

function showSettings() {
  document.getElementById('capacityInput').value = state.capacity;
  document.getElementById('resetTimeInput').value = state.resetTime;
  document.getElementById('roleSelect').value = state.role;
  document.getElementById('themeSelect').value = state.theme;
  document.getElementById('settingsModal').classList.remove('hidden');
}

function saveSettings() {
  const cap = parseInt(document.getElementById('capacityInput').value, 10);
  state.capacity = isNaN(cap) || cap < 1 ? 1 : cap;
  const rt = document.getElementById('resetTimeInput').value;
  state.resetTime = rt || '00:00';
  state.role = document.getElementById('roleSelect').value;
  state.theme = document.getElementById('themeSelect').value;
  saveState();
  applyRole();
  applyTheme();
  updateDisplay();
  document.getElementById('settingsModal').classList.add('hidden');
}

function computeForecast() {
  if (!state.history.length) return null;
  const now = new Date();
  const weekday = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const currentInterval = Math.floor(minutes / 5);
  const groups = {};
  state.history.forEach(e => {
    const t = new Date(e.timestamp);
    const wd = t.getDay();
    const idx = Math.floor((t.getHours() * 60 + t.getMinutes()) / 5);
    const key = `${wd}-${idx}`;
    if (!groups[key]) groups[key] = { sum: 0, count: 0 };
    groups[key].sum += e.delta;
    groups[key].count += 1;
  });
  let expectedChange = 0;
  for (let i = 1; i <= 12; i++) {
    const idx = (currentInterval + i) % (24 * 12);
    const key = `${weekday}-${idx}`;
    if (groups[key]) expectedChange += groups[key].sum / groups[key].count;
  }
  return Math.round(state.count + expectedChange);
}

function updateForecast() {
  const el = document.getElementById('forecastDisplay');
  if (state.role !== 'admin') {
    el.textContent = '';
    return;
  }
  const val = computeForecast();
  el.textContent = val !== null ? `Forventet om 60 min: ${val}` : '';
}

function finalizeReport(resetTime) {
  const day = new Date(resetTime);
  day.setDate(day.getDate() - 1);
  const dateStr = day.toISOString().split('T')[0];
  state.reports.push({
    date: dateStr,
    inn: state.daily.in,
    ut: state.daily.out,
    peak: state.daily.peak,
    peakTime: state.daily.peakTime
  });
  state.daily = { in: 0, out: 0, peak: 0, peakTime: null };
}

function performDailyResetIfNeeded() {
  const [h, m] = state.resetTime.split(':').map(Number);
  const now = new Date();
  const resetToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  const lastReset = state.lastReset ? new Date(state.lastReset) : new Date(0);
  if (now >= resetToday && lastReset < resetToday) {
    finalizeReport(resetToday);
    state.count = 0;
    state.lastReset = resetToday.toISOString();
    saveState();
    updateDisplay();
  }
}

// Event listeners
window.addEventListener('load', () => {
  loadState();
  applyTheme();
  applyRole();
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
  document.getElementById('btnReport').addEventListener('click', showReports);
  document.getElementById('reportClose').addEventListener('click', () => document.getElementById('reportModal').classList.add('hidden'));
});

