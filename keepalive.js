// ============================================================
// TwitchAlive: keep-alive в MAIN-мире.
//
// Изолированный мир content script'а не может подменить document.hidden —
// страница видит свою обёртку и продолжает считать вкладку свёрнутой.
// Поэтому подмена живёт отдельным файлом в MAIN-мире и стартует
// на document_start, раньше скриптов Twitch.
//
// Задача: пока вкладка свёрнута, плеер для Twitch остаётся «видимым»,
// не встаёт на паузу и не показывает рекламу — дропсы продолжают капать.
// ============================================================
(() => {
  'use strict';

  if (window.__twitchAliveKeepAlive) return;
  window.__twitchAliveKeepAlive = true;

  const define = (target, prop, value) => {
    try {
      Object.defineProperty(target, prop, { get: () => value, configurable: true });
    } catch (e) {
      // свойство уже неконфигурируемое — не повод падать
    }
  };

  // вкладка всегда «видима»
  define(Document.prototype, 'hidden', false);
  define(Document.prototype, 'visibilityState', 'visible');
  define(Document.prototype, 'webkitHidden', false);
  define(Document.prototype, 'webkitVisibilityState', 'visible');

  // и всегда «в фокусе»
  try {
    Document.prototype.hasFocus = () => true;
  } catch (e) { /* ignore */ }

  // Не пускаем к обработчикам Twitch события сворачивания и потери фокуса.
  // Слушатели вешаются на document_start, то есть раньше страницы.
  const swallow = (event) => {
    event.stopImmediatePropagation();
    event.stopPropagation();
  };

  for (const type of ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focus']) {
    window.addEventListener(type, swallow, true);
    document.addEventListener(type, swallow, true);
  }

  // ВАЖНО: таймеры здесь не трогаем. Урезание setTimeout/setInterval до
  // секунды ломает бэкоффы GraphQL, рекламу и плеер. Chrome и так не
  // тормозит вкладку, в которой играет видео со звуком.
  console.log('[TwitchAlive:keepalive] MAIN-мир: вкладка всегда «видима»');
})();
