// ============================================================
// Модуль «Twitch Keep Alive»: уведомления, авто-воспроизведение,
// авто-клик «Получить», статус стрима и статистика бонусов канала.
// Опции включаются в popup, значения хранятся в chrome.storage.local.
//
// Подмена видимости вкладки живёт в keepalive.js (MAIN-мир): из
// изолированного мира content script'а страница её не видит.
// ============================================================

// ============================================================
// 1. НАСТРОЙКИ ИЗ POPUP
// ============================================================
let settings = { ...TAK_DEFAULTS };

function applySettings(value) {
    settings = { ...TAK_DEFAULTS, ...(value || {}) };
    // keepalive.js живёт в MAIN-мире и не может читать chrome.storage
    window.postMessage({ __takSettings: settings }, '*');
}

chrome.storage.local.get({ settings: TAK_DEFAULTS }, (data) => {
    applySettings(data.settings);
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) applySettings(changes.settings.newValue);
});

// Chrome показывает запрос уведомлений только после действия пользователя,
// поэтому просим при первом клике, а не при загрузке страницы.
function askNotifications() {
    document.removeEventListener('pointerdown', askNotifications, true);
    if (settings.notifications && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}
document.addEventListener('pointerdown', askNotifications, true);

// ============================================================
// 2. ПРИНУДИТЕЛЬНОЕ ВОССТАНОВЛЕНИЕ ВОСПРОИЗВЕДЕНИЯ
// ============================================================
function ensurePlaying() {
    if (!settings.autoPlay) return;

    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        if (video.paused && !video.ended && window.location.hostname.includes('twitch.tv')) {
            video.play().catch(() => { });
            console.log('🔄 Twitch Keep Alive: видео перезапущено через play()');
        }
    });

    const playButton = document.querySelector('[data-a-target="player-play-pause-button"][data-a-player-state="paused"]');
    if (playButton) {
        playButton.click();
        console.log('🔄 Twitch Keep Alive: нажата кнопка воспроизведения');
    }
}
setInterval(ensurePlaying, 2000);

// ============================================================
// 3. АВТОМАТИЧЕСКОЕ НАЖАТИЕ НА КНОПКИ "ПОЛУЧИТЬ" И "ПОЛУЧИТЬ БОНУС"
// ============================================================
const DROP_LABELS = /^(получить|получить сейчас|claim|claim now)$/i;
const BONUS_SELECTOR = [
    'button[aria-label="Получить бонус"]:not([disabled])',
    'button[aria-label="Claim Bonus" i]:not([disabled])',
    'button[aria-label="Get Bonus" i]:not([disabled])'
].join(', ');

let lastBonusClick = 0;

function channelName() {
    return (window.location.pathname.split('/').filter(Boolean)[0] || 'unknown').toLowerCase();
}

function recordBonus(channel) {
    chrome.storage.local.get({ bonusStats: { channels: {} } }, (data) => {
        const stats = data.bonusStats && data.bonusStats.channels ? data.bonusStats : { channels: {} };
        const row = stats.channels[channel] || { count: 0, last: 0 };
        row.count += 1;
        row.last = Date.now();
        stats.channels[channel] = row;
        chrome.storage.local.set({ bonusStats: stats });
    });
}

function collectRewards() {
    // «Получить»/«Получить сейчас» — только на страницах дропов и только
    // внутри строки награды, чтобы не нажать чужую кнопку на других страницах.
    if (settings.autoDrops && window.location.pathname.startsWith('/drops')) {
        const hasTowers = !!document.querySelector('.tw-tower');

        for (const label of document.querySelectorAll('[data-a-target="tw-core-button-label-text"]')) {
            if (!DROP_LABELS.test(label.textContent.trim())) continue;

            const button = label.closest('button, a');
            if (!button || button.disabled) continue;
            if (hasTowers && !button.closest('.tw-tower')) continue;

            button.click();
            console.log(`🎁 Twitch Keep Alive: нажата кнопка "${label.textContent.trim()}" (дропсы)`);
            break;
        }
    }

    // Кнопка "Получить бонус" / "Claim Bonus" (бонусы канала).
    // Кулдаун, чтобы один и тот же бонус не считался каждые 10 секунд.
    if (settings.autoBonus && Date.now() - lastBonusClick > 60000) {
        const bonusButton = document.querySelector(BONUS_SELECTOR);
        if (bonusButton) {
            lastBonusClick = Date.now();
            bonusButton.click();
            recordBonus(channelName());
            console.log('🎁 Twitch Keep Alive: нажата кнопка "Получить бонус" (бонусы канала)');
        }
    }
}
setInterval(collectRewards, 10000);

// ============================================================
// 4. ОТСЛЕЖИВАНИЕ ОКОНЧАНИЯ СТРИМА И СМЕНЫ ИГРЫ
// ============================================================
let wasOnline = false;
let notifiedOffline = false;
let lastGameTitle = ''; // храним предыдущее название игры

function checkStreamStatus() {
    if (!settings.notifications) return;

    // Не проверяем на страницах видео по запросу и клипов
    if (window.location.pathname.includes('/videos/') || window.location.pathname.includes('/clip/')) {
        return;
    }

    const offlineIndicator = document.querySelector('.channel-status-info--offline, .stream-title--offline, [data-test-selector="stream-status"]');
    const videos = document.querySelectorAll('video');
    const video = videos.length > 0 ? videos[0] : null;

    const isOnline = video && !video.ended && !video.error && !offlineIndicator;
    const gameLink = document.querySelector('[data-a-target="stream-game-link"]');
    const currentGame = gameLink ? gameLink.textContent.trim() : '';

    if (isOnline) {
        // Стрим онлайн
        wasOnline = true;
        notifiedOffline = false;

        // Проверяем изменение игры
        if (currentGame && currentGame !== lastGameTitle) {
            const channelName = window.location.pathname.split('/').filter(Boolean)[0] || 'Канал';
            let message = '';
            if (lastGameTitle) {
                message = `${channelName} переключил игру с "${lastGameTitle}" на "${currentGame}"`;
            } else {
                message = `${channelName} начал играть в "${currentGame}"`;
            }
            if (Notification.permission === 'granted') {
                new Notification('🔄 Смена игры', {
                    body: message,
                    icon: 'https://www.twitch.tv/favicon.ico',
                    tag: 'twitch-game-change',
                    requireInteraction: false
                });
                console.log(`📢 Twitch Keep Alive: смена игры: ${message}`);
            }
            lastGameTitle = currentGame;
        }
    } else {
        // Стрим офлайн
        if (wasOnline && !notifiedOffline) {
            const channelName = window.location.pathname.split('/').filter(Boolean)[0] || 'Канал';
            const gameForNotification = currentGame || lastGameTitle || 'стрим';
            if (Notification.permission === 'granted') {
                new Notification('🔴 Стрим завершён!', {
                    body: `${channelName} закончил трансляцию (${gameForNotification}).`,
                    icon: 'https://www.twitch.tv/favicon.ico',
                    tag: 'twitch-stream-ended',
                    requireInteraction: true
                });
                console.log('📢 Twitch Keep Alive: уведомление об окончании стрима отправлено');
            }
            notifiedOffline = true;
            wasOnline = false;
            // Сбрасываем lastGameTitle, чтобы при следующем стриме было уведомление о начале игры
            lastGameTitle = '';
        }
    }
}

// Проверяем состояние каждые 30 секунд
setInterval(checkStreamStatus, 30000);

console.log('✅ Twitch Keep Alive: расширение успешно загружено и работает!');