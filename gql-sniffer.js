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

  /** Twitch шлёт операции пакетами: описываем каждый элемент с его индексом. */
  const describe = (body) => {
    try {
      const data = typeof body === 'string' ? JSON.parse(body) : body;
      const list = Array.isArray(data) ? data : [data];
      const out = [];
      for (let index = 0; index < list.length; index++) {
        const item = list[index];
        if (!item || typeof item !== 'object' || !item.operationName) continue;
        const hash = item.extensions && item.extensions.persistedQuery
          ? item.extensions.persistedQuery.sha256Hash
          : '';
        out.push({
          op: item.operationName,
          hash: hash || '',
          vars: item.variables || null,
          index
        });
      }
      return out.length ? out : null;
    } catch (e) {
      return null;
    }
  };

  const interesting = (descs) => (descs || []).filter((desc) => /drops|inventory/i.test(desc.op));

  /** Разложить ответ пакета по описаниям запросов. */
  const reply = (json, wanted) => {
    const list = Array.isArray(json) ? json : [json];
    for (const desc of wanted) {
      const data = Array.isArray(json) ? list[desc.index] : json;
      if (data == null) continue;
      send({ op: desc.op, hash: desc.hash, vars: desc.vars, data });
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
          const wanted = interesting(describe(init.body));
          if (wanted.length) {
            result
              .then((res) => {
                try {
                  res.clone().json()
                    .then((json) => reply(json, wanted))
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
          const wanted = interesting(describe(body));
          if (wanted.length) {
            this.addEventListener('load', () => {
              try {
                reply(JSON.parse(this.responseText), wanted);
              } catch (e) { /* молча */ }
            });
          }
        }
      } catch (e) { /* молча */ }
      return nativeSend.apply(this, arguments);
    };
  } catch (e) { /* молча */ }
})();
