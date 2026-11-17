// ============================================================
// Popup: тумблеры опций и статистика бонусов канала.
// ============================================================
const OPTIONS = [
  ['keepAlive', 'Держать вкладку активной', 'Видео не встаёт на паузу, дропсы идут в свёрнутой вкладке'],
  ['autoPlay', 'Восстанавливать воспроизведение', 'Нажимать play, если плеер остановился'],
  ['autoDrops', 'Забирать дропсы', 'Автоматически нажимать «Получить»'],
  ['autoBonus', 'Забирать бонус канала', 'Прожимать кнопку бонуса, когда она загорается'],
  ['notifications', 'Уведомления', 'Конец стрима и смена игры']
];

const BONUS_POINTS = 50;

const $ = (id) => document.getElementById(id);

async function main() {
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;

  const stored = await chrome.storage.local.get(['settings', 'bonusStats']);
  const settings = { ...TAK_DEFAULTS, ...(stored.settings || {}) };

  const box = $('settings');
  for (const [key, title, hint] of OPTIONS) {
    const row = document.createElement('label');
    row.className = 'option';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = settings[key] !== false;
    input.addEventListener('change', () => {
      settings[key] = input.checked;
      chrome.storage.local.set({ settings });
    });

    const text = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = title;
    const desc = document.createElement('span');
    desc.textContent = hint;
    text.append(name, desc);

    row.append(input, text);
    box.append(row);
  }

  renderStats(stored.bonusStats);

  $('reset').addEventListener('click', () => {
    chrome.storage.local.set({ bonusStats: { channels: {} } });
    renderStats({ channels: {} });
  });
}

function renderStats(stats) {
  const channels = (stats && stats.channels) || {};
  const rows = Object.entries(channels).sort((a, b) => b[1].count - a[1].count);
  const total = rows.reduce((sum, [, row]) => sum + row.count, 0);

  $('summary').innerHTML = total
    ? `Собрано <b>${total}</b> раз · ≈ <b>${total * BONUS_POINTS}</b> очков`
    : 'Пока пусто';

  const list = $('channels');
  list.textContent = '';

  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Бонусы канала ещё не собирались.';
    list.append(li);
    return;
  }

  for (const [name, row] of rows.slice(0, 20)) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = name;
    const right = document.createElement('span');
    right.textContent = `${row.count}× · ≈ ${row.count * BONUS_POINTS}`;
    li.append(left, right);
    list.append(li);
  }
}

main();
