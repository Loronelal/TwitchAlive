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
// Выключается тумблером в popup: content.js присылает настройку сообщением.
// ============================================================
(() => {
  'use strict';

  if (window.__twitchAliveKeepAlive) return;
  window.__twitchAliveKeepAlive = true;

  const PROPS = [
    ['hidden', false],
    ['visibilityState', 'visible'],
    ['webkitHidden', false],
    ['webkitVisibilityState', 'visible']
  ];
  const EVENTS = ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focus'];

  const native = PROPS.map(([prop]) => Object.getOwnPropertyDescriptor(Document.prototype, prop));
  const nativeHasFocus = Document.prototype.hasFocus;

  const define = (prop, value) => {
    try {
      Object.defineProperty(Document.prototype, prop, { get: () => value, configurable: true });
    } catch (e) {
      // свойство уже неконфигурируемое — не повод падать
    }
  };

  // Не пускаем к обработчикам Twitch события сворачивания и потери фокуса.
  const swallow = (event) => {
    event.stopImmediatePropagation();
    event.stopPropagation();
  };

  let enabled = false;

  const setEnabled = (on) => {
    if (on === enabled) return;
    enabled = on;

    PROPS.forEach(([prop, value], i) => {
      try {
        if (on) {
          define(prop, value);
        } else if (native[i]) {
          Object.defineProperty(Document.prototype, prop, native[i]);
        } else {
          delete Document.prototype[prop];
        }
      } catch (e) { /* ignore */ }
    });

    try {
      Document.prototype.hasFocus = on ? () => true : nativeHasFocus;
    } catch (e) { /* ignore */ }

    for (const type of EVENTS) {
      const method = on ? 'addEventListener' : 'removeEventListener';
      window[method](type, swallow, true);
      document[method](type, swallow, true);
    }

    console.log(`[TwitchAlive:keepalive] вкладка ${on ? 'всегда «видима»' : 'снова как обычно'}`);
  };

  // content.js присылает сюда настройки из chrome.storage
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const cfg = event.data && event.data.__takSettings;
    if (cfg && typeof cfg.keepAlive === 'boolean') setEnabled(cfg.keepAlive);
  });

  // До первой настройки работаем как раньше
  setEnabled(true);

  // ВАЖНО: таймеры здесь не трогаем. Урезание setTimeout/setInterval до
  // секунды ломает бэкоффы GraphQL, рекламу и плеер. Chrome и так не
  // тормозит вкладку, в которой играет видео со звуком.
})();
