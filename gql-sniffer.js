/* ============================================================
   Twitch Keep Alive — перехватчик GraphQL-ответов (MAIN world)
   ------------------------------------------------------------
   Страница сама ходит в gql.twitch.tv за инвентарём дропов. Мы не угадываем
   persisted query, а подсматриваем уже сделанный запрос: operationName,
   sha256Hash и переменные. Ответ целиком отправляем в изолированный мир
   расширения через window.postMessage — там его разбирает favorites.js.

   Скрипт обязан быть абсолютно прозрачным: любые ошибки глотаем, fetch и
   XMLHttpRequest возвращаем как есть.
   ============================================================ */
(() => {
  'use strict';

  const GQL = 'gql.twitch.tv';
  const TAG = '__takGql';

  const send = (payload) => {
    try {
      window.postMessage({ [TAG]: payload }, '*');
    } catch (e) { /* молча */ }
  };

  const describe = (body) => {
    try {
      const data = typeof body === 'string' ? JSON.parse(body) : body;
      if (!data || typeof data !== 'object' || !data.operationName) return null;
      const hash = data.extensions && data.extensions.persistedQuery
        ? data.extensions.persistedQuery.sha256Hash
        : '';
      return { op: data.operationName, hash: hash || '', vars: data.variables || null };
    } catch (e) {
      return null;
    }
  };

  /* ---------- fetch ---------- */
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      const result = nativeFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const method = (init && init.method) || (input && input.method) || 'GET';
        if (url.indexOf(GQL) !== -1 && String(method).toUpperCase() === 'POST' && init && init.body) {
          const desc = describe(init.body);
          if (desc && /drops|inventory/i.test(desc.op)) {
            result
              .then((res) => {
                try {
                  res.clone().json()
                    .then((json) => send({ ...desc, data: json }))
                    .catch(() => {});
                } catch (e) { /* молча */ }
              })
              .catch(() => {});
          }
        }
      } catch (e) { /* молча */ }
      return result;
    };
  }

  /* ---------- XMLHttpRequest: Apollo иногда ходит через него ---------- */
  try {
    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        this.__takUrl = url;
        this.__takMethod = method;
      } catch (e) { /* молча */ }
      return nativeOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      try {
        if (this.__takUrl && String(this.__takUrl).indexOf(GQL) !== -1) {
          const desc = describe(body);
          if (desc && /drops|inventory/i.test(desc.op)) {
            this.addEventListener('load', () => {
              try {
                send({ ...desc, data: JSON.parse(this.responseText) });
              } catch (e) { /* молча */ }
            });
          }
        }
      } catch (e) { /* молча */ }
      return nativeSend.apply(this, arguments);
    };
  } catch (e) { /* молча */ }
})();
