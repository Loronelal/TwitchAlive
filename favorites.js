/* ============================================================
   Twitch Keep Alive — «Избранное»
   ------------------------------------------------------------
   Локальный список избранных игр для страницы дропов.
     • на карточке игры появляется ★ (клик — добавить/убрать);
     • в хедере рядом с вкладками «Инвентарь / Все кампании /
       Значок…» появляется пункт «★ Избранное (N)»:
         – клик по нему включает фильтр «только избранное»,
         – стрелка ▾ открывает список избранного.

   Всё хранится в chrome.storage.local, на сервер ничего не уходит.
   ============================================================ */
(() => {
  'use strict';

  const FAV_KEY = 'favoriteGames';
  const FLAG_KEY = 'onlyFavorites';
  const DONE_KEY = 'hideCompleted';
  const STATS_KEY = 'inventoryStats';
  const GQL_OP_KEY = 'gqlOp';
  const GQL_OK_KEY = 'gqlOk';
  const STAR_CLASS = 'tak-fav-star';
  const PILL_CLASS = 'tak-done-pill';
  const CAMP_PILL_CLASS = 'tak-camp-pill';
  const LI_CLASS = 'tak-fav-li';
  const PANEL_CLASS = 'tak-fav-panel';

  const log = (...a) => console.log('%c[TwitchAlive:fav]', 'color:#a970ff;font-weight:600', ...a);

  /** Метка сборки: по ней в консоли видно, что загружен именно свежий код. */
  const BUILD = 'scan-all-2';
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();

  /* ============================================================
     1. ХРАНИЛИЩЕ: chrome.storage.local -> localStorage
     ============================================================ */
  const mem = new Map();

  const chromeArea = () => {
    try {
      return (globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.local) || null;
    } catch {
      return null;
    }
  };

  const storage = {
    async get(key) {
      const area = chromeArea();
      if (area) {
        try {
          const res = await area.get(key);
          if (res && key in res) return res[key];
          return undefined;
        } catch (e) {
          log('chrome.storage прочитать не удалось', e);
        }
      }
      try {
        const raw = localStorage.getItem('tak_' + key);
        return raw == null ? undefined : JSON.parse(raw);
      } catch {
        return mem.get(key);
      }
    },

    async set(key, value) {
      const area = chromeArea();
      if (area) {
        try {
          await area.set({ [key]: value });
          return;
        } catch (e) {
          log('chrome.storage записать не удалось', e);
        }
      }
      try {
        localStorage.setItem('tak_' + key, JSON.stringify(value));
      } catch {
        mem.set(key, value);
      }
    }
  };

  /* ============================================================
     2. СОСТОЯНИЕ
     ============================================================ */
  /** norm(name) -> имя в том виде, как его показал Twitch */
  const favorites = new Map();
  let onlyFavorites = false;
  let started = false;

  /** Статистика из инвентаря: id игры -> { total, earned, allDone }. */
  let stats = null;
  let statsSaved = '';

  /** Захваченная GraphQL-операция инвентаря и признак, что её ответ мы понимаем. */
  let gqlOp = null;
  let gqlOk = false;

  const persistFavorites = () => storage.set(FAV_KEY, [...favorites.values()]);
  const persistFlag = () => storage.set(FLAG_KEY, onlyFavorites);

  const isFavorite = (name) => favorites.has(norm(name));

  /* ============================================================
     3. РАЗМЕТКА: игра, звёздочка, что прятать
     ============================================================ */
  const HEADER_SEL = '.accordion-header';

  /** Название игры из карточки: сначала alt картинки, потом первый <p>. */
  function gameOf(header) {
    const img = header.querySelector('img[alt]');
    if (img && norm(img.alt)) return img.alt.replace(/\s+/g, ' ').trim();
    const p = header.querySelector('p');
    return p ? rawText(p) : '';
  }

  /** Текст элемента без наших вставок: ★ и счётчик «3/5» живут внутри <p>. */
  function rawText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        text += node.data;
      } else if (node.nodeType === 1
        && !node.classList.contains(STAR_CLASS)
        && !node.classList.contains(PILL_CLASS)
        && !node.classList.contains(CAMP_PILL_CLASS)) {
        text += node.textContent;
      }
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  const cleanText = (el) => norm(rawText(el));

  /** Абзац с названием игры внутри карточки. */
  function nameElementOf(header, name) {
    const key = norm(name);
    if (!key) return null;
    for (const p of header.querySelectorAll('p')) {
      if (cleanText(p) === key) return p;
    }
    return null;
  }

  /**
   * Что скрывать при фильтре «только избранное».
   * Обычный случай: заголовок и панель с наградами — соседи в общей обёртке,
   * поэтому прячем обёртку. Если в контейнере несколько заголовков —
   * прячем сам заголовок и следующий за ним блок.
   */
  function partsFor(header) {
    const parent = header.parentElement;
    if (!parent) return [header];

    const siblingHeaders = [...parent.children].filter(
      (el) => el.classList && el.classList.contains('accordion-header')
    );

    if (siblingHeaders.length > 1) {
      const parts = [header];
      const next = header.nextElementSibling;
      if (next && !(next.classList && next.classList.contains('accordion-header'))) parts.push(next);
      return parts;
    }
    return [parent];
  }

  /** Скрываем/показываем через inline-style: не зависим от CSP и классов Twitch. */
  function setHidden(el, on) {
    if (on) {
      if (el.dataset.takFavHidden !== '1') {
        el.dataset.takFavPrevDisplay = el.style.display || '';
        el.dataset.takFavHidden = '1';
      }
      if (el.style.display !== 'none') el.style.display = 'none';
    } else if (el.dataset.takFavHidden === '1') {
      el.style.display = el.dataset.takFavPrevDisplay || '';
      delete el.dataset.takFavHidden;
      delete el.dataset.takFavPrevDisplay;
    }
  }

  /* ============================================================
     4. ★ НА КАРТОЧКЕ ИГРЫ
     ============================================================ */
  const GOLD = '#ffd166';
  const GREY = '#adadb8';

  function applyStarState(btn, isFav) {
    const want = isFav ? '\u2605' : '\u2606';   // ★ / ☆
    if (btn.textContent !== want) btn.textContent = want;
    btn.style.color = isFav ? GOLD : GREY;
    btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    btn.title = isFav ? 'Убрать из избранного' : 'В избранное';
    btn.setAttribute('aria-label', btn.title);

    if (isFav) {
      // избранное видно всегда, иначе непонятно, что уже отмечено
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    } else {
      btn.style.opacity = '0';
      btn.style.pointerEvents = 'none';
    }
  }

  function makeStar(header) {
    // именно span, а не button: звёздочка живёт внутри кнопки-аккордеона,
    // а вложенный <button> ломает разметку при перерисовке через innerHTML
    const btn = document.createElement('span');
    btn.className = STAR_CLASS;
    btn.dataset.takStar = '1';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.textContent = '\u2606';
    // по умолчанию — инлайн сразу за последней буквой названия
    Object.assign(btn.style, {
      position: 'static',
      display: 'inline-block',
      left: 'auto',
      right: 'auto',
      top: 'auto',
      transform: 'none',
      verticalAlign: 'middle',
      width: '20px',
      height: '20px',
      padding: '0',
      margin: '0 0 0 6px',
      border: '0',
      borderRadius: '4px',
      background: 'transparent',
      color: GREY,
      font: '400 15px/20px system-ui, "Segoe UI", Roboto, Arial, sans-serif',
      textAlign: 'center',
      cursor: 'pointer',
      opacity: '0',
      pointerEvents: 'none',
      transition: 'opacity .12s ease, color .12s ease'
    });

    ['pointerdown', 'mousedown', 'click'].forEach((type) =>
      btn.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
      })
    );

    btn.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      // имя приходит из apply(): читать его из текста нельзя, там уже наша ★
      const name = btn._game || gameOf(header);
      if (name) toggleFavorite(name);
    });

    // span не кнопка, поэтому Enter/Space обрабатываем сами
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      e.stopPropagation();
      const name = btn._game || gameOf(header);
      if (name) toggleFavorite(name);
    });

    return btn;
  }

  /** Инлайн-режим: звезда едет сразу за текстом названия, ничего не сдвигая. */
  function placeStarInline(star) {
    Object.assign(star.style, {
      position: 'static',
      display: 'inline-block',
      left: 'auto',
      right: 'auto',
      top: 'auto',
      transform: 'none',
      verticalAlign: 'middle',
      margin: '0 0 0 6px'
    });
  }

  /** Абсолютный режим: угол заголовка (запасной вариант, если разметка чужая). */
  function placeStarAbsolute(star, parent, right) {
    if (star.parentElement !== parent) parent.appendChild(star);
    Object.assign(star.style, {
      position: 'absolute',
      display: 'inline-block',
      left: 'auto',
      right: right,
      top: '50%',
      transform: 'translateY(-50%)',
      verticalAlign: 'middle',
      margin: '0'
    });
  }

  function placeStar(header, star, name) {
    const host = nameElementOf(header, name);

    if (star._host && star._host !== host) {
      // убираем отступ, который ставила предыдущая версия расширения
      star._host.style.paddingLeft = '';
      star._host = null;
    }

    if (!host) {
      star._host = null;
      placeStarAbsolute(star, header, '44px');
      return;
    }

    // старые версии добавляли padding-left: 24px — возвращаем как было
    if (host.style.paddingLeft === '24px') host.style.paddingLeft = '';

    if (star.parentElement !== host) host.appendChild(star);
    star._host = host;

    if (star._abs) placeStarAbsolute(star, host, '0px');
    else placeStarInline(star);
  }

  /**
   * Если имя длинное и не влезает вместе со звездой, Twitch обрежет строку
   * многоточием и звезда уедет за край. Тогда один раз переставляем её
   * абсолютно в правый край абзаца, чтобы осталась кликабельной.
   */
  function fixClippedStar(header, star, host) {
    if (!host || star._abs || star._checked) return;
    star._checked = true;

    // читаем только размеры — ни одной записи в стили до замера
    const clipped = host.scrollWidth > host.clientWidth + 1;
    if (!clipped) return;

    star._abs = true;
    placeStarAbsolute(star, host, '0px');
  }

  function ensureStar(header, name) {
    if (header.style.position !== 'relative' && header.style.position !== 'absolute') {
      header.style.position = 'relative';
    }

    let btn = header.querySelector('.' + STAR_CLASS);
    if (!btn) {
      btn = makeStar(header);
      header.appendChild(btn);
    }

    if (btn._game !== name) {
      btn._game = name;
      btn._abs = false;
      btn._checked = false;
    }

    placeStar(header, btn, name);

    if (header.dataset.takHover !== '1') {
      header.dataset.takHover = '1';
      const starOf = () => header.querySelector('.' + STAR_CLASS);
      header.addEventListener('mouseenter', () => {
        const b = starOf();
        if (!b || b.getAttribute('aria-pressed') === 'true') return;
        b.style.opacity = '1';
        b.style.pointerEvents = 'auto';
      });
      header.addEventListener('mouseleave', () => {
        const b = starOf();
        if (!b || b.getAttribute('aria-pressed') === 'true') return;
        b.style.opacity = '0';
        b.style.pointerEvents = 'none';
      });
      header.addEventListener('focusin', () => {
        const b = starOf();
        if (!b) return;
        b.style.opacity = '1';
        b.style.pointerEvents = 'auto';
      });
      header.addEventListener('focusout', () => {
        const b = starOf();
        if (!b || b.getAttribute('aria-pressed') === 'true') return;
        b.style.opacity = '0';
        b.style.pointerEvents = 'none';
      });
    }

    return btn;
  }

  /* ============================================================
     5. ХЕДЕР: вкладка «Избранное» + выпадающий список
     ============================================================ */
  const ui = {
    wrapper: null, li: null, main: null, count: null, more: null,
    panel: null, list: null, toggle: null, clear: null, scanBtn: null, hint: null, open: false,
    doneLi: null, doneMain: null, doneCount: null
  };

  function styles(el, s) {
    for (const key of Object.keys(s)) {
      const value = s[key];
      if (key === 'type' || key === 'textContent') el[key] = value;
      else el.style[key] = value;
    }
    return el;
  }

  const FONT = '600 14px/1.2 system-ui, "Segoe UI", Roboto, Arial, sans-serif';

  /** Найти именно полосу вкладок дропов (не любую tablist на странице). */
  function findTablist() {
    const lists = [...document.querySelectorAll('ul[role="tablist"]')];
    return lists.find((ul) => ul.querySelector('a[href*="/drops"]')) || null;
  }

  function buildControl() {
    if (ui.wrapper) return;

    const wrapper = styles(document.createElement('div'), {
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      position: 'relative',
      font: FONT
    });

    const main = styles(document.createElement('button'), {
      type: 'button',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      height: '32px',
      padding: '0 10px',
      border: '0',
      borderRadius: '4px',
      background: 'transparent',
      color: '#efeff1',
      font: FONT,
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    });
    main.className = 'tak-fav-main';

    const star = styles(document.createElement('span'), {
      color: GOLD,
      fontSize: '15px',
      lineHeight: '1'
    });
    star.textContent = '\u2605';

    const label = document.createElement('span');
    label.textContent = 'Избранное';

    const count = styles(document.createElement('span'), {
      padding: '1px 6px',
      borderRadius: '9px',
      background: 'rgba(255,255,255,0.14)',
      color: '#efeff1',
      font: '600 11px/1.5 system-ui, Arial, sans-serif'
    });
    count.className = 'tak-fav-count';
    count.textContent = '0';

    main.append(star, label, count);

    const more = styles(document.createElement('button'), {
      type: 'button',
      width: '18px',
      height: '32px',
      padding: '0',
      margin: '0 0 0 -2px',
      border: '0',
      borderRadius: '4px',
      background: 'transparent',
      color: '#adadb8',
      font: '600 12px/1 system-ui, Arial, sans-serif',
      cursor: 'pointer'
    });
    more.className = 'tak-fav-more';
    more.textContent = '\u25BE';
    more.title = 'Список избранного';
    more.setAttribute('aria-label', 'Список избранного');
    more.setAttribute('aria-expanded', 'false');

    wrapper.append(main, more);

    // ---- выпадающая панель ----
    const panel = styles(document.createElement('div'), {
      position: 'fixed',
      zIndex: '2147483000',
      width: '290px',
      maxHeight: '60vh',
      display: 'none',
      flexDirection: 'column',
      gap: '8px',
      boxSizing: 'border-box',
      padding: '10px',
      border: '1px solid #2f2f35',
      borderRadius: '8px',
      background: '#18181b',
      color: '#efeff1',
      boxShadow: '0 8px 28px rgba(0,0,0,.6)',
      font: '13px/1.4 system-ui, "Segoe UI", Roboto, Arial, sans-serif'
    });
    panel.className = PANEL_CLASS;

    const head = styles(document.createElement('div'), {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    });
    const title = document.createElement('strong');
    title.textContent = 'Избранное';
    head.append(title);

    const list = styles(document.createElement('ul'), {
      margin: '0',
      padding: '0',
      listStyle: 'none',
      overflowY: 'auto',
      maxHeight: '35vh',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px'
    });
    list.className = 'tak-fav-list';

    const toggle = styles(document.createElement('button'), {
      type: 'button',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      padding: '6px 8px',
      border: '1px solid #3a3a3d',
      borderRadius: '4px',
      background: 'transparent',
      color: '#efeff1',
      font: '600 12px/1.2 system-ui, Arial, sans-serif',
      cursor: 'pointer'
    });
    toggle.className = 'tak-fav-toggle';
    toggle.textContent = 'Только избранное';
    toggle.setAttribute('aria-pressed', 'false');

    const clear = styles(document.createElement('button'), {
      type: 'button',
      padding: '6px 8px',
      border: '1px solid #3a3a3d',
      borderRadius: '4px',
      background: 'transparent',
      color: '#adadb8',
      font: '600 12px/1.2 system-ui, Arial, sans-serif',
      cursor: 'pointer'
    });
    clear.className = 'tak-fav-clear';
    clear.textContent = 'Очистить список';

    const hint = styles(document.createElement('div'), {
      color: '#84848f',
      font: '11px/1.35 system-ui, Arial, sans-serif'
    });
    hint.textContent = 'Список хранится только в этом браузере. Наведите на карточку игры и нажмите ★.';

    const scanBtn = styles(document.createElement('button'), {
      type: 'button',
      padding: '6px 8px',
      border: '1px solid #3a3a3d',
      borderRadius: '4px',
      background: 'transparent',
      color: '#bf94ff',
      font: '600 12px/1.2 system-ui, Arial, sans-serif',
      cursor: 'pointer'
    });
    scanBtn.className = 'tak-scan-all';
    scanBtn.textContent = 'Собрать данные по избранным';
    scanBtn.title = 'Прочитать награды категорий из избранного и запомнить в кэш';
    scanBtn.addEventListener('click', () => {
      closePanel();
      scanAllRows();
    });

    panel.append(head, list, toggle, clear, scanBtn, hint);
    // панель фиксированная, поэтому живёт прямо в body: не обрезается
    // скроллом полосы вкладок
    if (document.body) document.body.append(panel);

    ui.wrapper = wrapper;
    ui.main = main;
    ui.count = count;
    ui.more = more;
    ui.panel = panel;
    ui.list = list;
    ui.toggle = toggle;
    ui.clear = clear;
    ui.scanBtn = scanBtn;
    ui.hint = hint;

    main.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOnlyFavorites(!onlyFavorites);
    });
    more.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });
    toggle.addEventListener('click', () => setOnlyFavorites(!onlyFavorites));
    clear.addEventListener('click', () => clearFavorites());

    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });
    window.addEventListener('resize', closePanel);
    window.addEventListener('scroll', (e) => {
      if (ui.open && !(ui.panel && ui.panel.contains(e.target))) closePanel();
    }, true);
  }

  function onDocMouseDown(e) {
    if (!ui.open) return;
    if (ui.panel && ui.panel.contains(e.target)) return;
    if (ui.wrapper && ui.wrapper.contains(e.target)) return;
    closePanel();
  }

  /** Есть ли статистика из инвентаря (его открывали в этом браузере). */
  const hasStats = () => !!(stats && stats.games && Object.keys(stats.games).length);

  const onDropsPage = () => location.pathname.indexOf('/drops') === 0;

  function hideAllControls() {
    if (ui.wrapper) ui.wrapper.style.display = 'none';
    if (ui.doneLi) ui.doneLi.style.display = 'none';
    closePanel();
  }

  function showControlInTablist(tablist) {
    if (!ui.wrapper) return;

    if (!ui.li) {
      ui.li = document.createElement('li');
      ui.li.className = LI_CLASS;
      ui.li.setAttribute('role', 'presentation');
      Object.assign(ui.li.style, { display: 'flex', alignItems: 'center', listStyle: 'none', flex: '0 0 auto' });
      ui.li.append(ui.wrapper);
    }
    if (ui.li.parentElement !== tablist) tablist.append(ui.li);

    // снимаем стили «плавающей» кнопки, если она раньше рисовалась вне вкладок
    Object.assign(ui.wrapper.style, {
      position: '',
      top: '',
      right: '',
      zIndex: '',
      padding: '',
      borderRadius: '',
      background: '',
      boxShadow: '',
      display: 'flex'
    });
  }

  /** Наши кнопки живут только на страницах дропов. */
  function mountControl() {
    const tablist = findTablist();
    const hasInventory = !!document.querySelector(CAMPAIGN_SEL);

    if (!onDropsPage()) {
      hideAllControls();
      return;
    }

    if (!ui.wrapper) return;

    if (tablist) {
      showControlInTablist(tablist);

      // вкладка «Готово» — на инвентаре и на «Все кампании» (по данным инвентаря)
      if (hasInventory || hasStats()) {
        buildDoneControl();
        if (ui.doneLi.parentElement !== tablist) tablist.append(ui.doneLi);
        ui.doneLi.style.display = 'flex';
      } else if (ui.doneLi) {
        ui.doneLi.style.display = 'none';
      }
      return;
    }

    // на странице дропов без полосы вкладок — компактная кнопка сверху
    if (ui.li && ui.li.parentElement) ui.li.remove();
    if (ui.doneLi) ui.doneLi.style.display = 'none';
    if (ui.wrapper.parentElement !== document.body) document.body.append(ui.wrapper);
    Object.assign(ui.wrapper.style, {
      position: 'fixed',
      top: '64px',
      right: '16px',
      zIndex: '2147483000',
      padding: '2px',
      borderRadius: '6px',
      background: '#18181b',
      boxShadow: '0 2px 12px rgba(0,0,0,.55)',
      display: 'flex'
    });
  }

  function setText(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  function renderControl() {
    if (!ui.main) return;
    setText(ui.count, String(favorites.size));
    ui.main.style.color = onlyFavorites ? '#bf94ff' : '#efeff1';
    ui.main.style.background = onlyFavorites ? 'rgba(145,71,255,.16)' : 'transparent';
    ui.main.setAttribute('aria-pressed', onlyFavorites ? 'true' : 'false');
    ui.main.title = onlyFavorites ? 'Показать все игры' : 'Показать только избранное';

    ui.toggle.style.borderColor = onlyFavorites ? '#9147ff' : '#3a3a3d';
    ui.toggle.style.color = onlyFavorites ? '#bf94ff' : '#efeff1';
    ui.toggle.setAttribute('aria-pressed', onlyFavorites ? 'true' : 'false');
    ui.clear.style.display = favorites.size ? 'block' : 'none';

    if (ui.scanBtn) {
      setText(ui.scanBtn, `Собрать данные по избранным (${favorites.size})`);
      ui.scanBtn.disabled = favorites.size === 0;
      ui.scanBtn.style.opacity = favorites.size ? '1' : '0.5';
      ui.scanBtn.style.cursor = favorites.size ? 'pointer' : 'default';
    }
  }

  function renderList() {
    if (!ui.list) return;
    ui.list.textContent = '';

    if (!favorites.size) {
      const empty = styles(document.createElement('li'), {
        color: '#84848f',
        padding: '6px 2px',
        font: '12px/1.4 system-ui, Arial, sans-serif'
      });
      empty.textContent = 'Пока пусто. Наведите на карточку игры и нажмите ★.';
      ui.list.append(empty);
      renderControl();
      return;
    }

    for (const [key, name] of favorites) {
      const li = styles(document.createElement('li'), {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '3px 2px'
      });

      const label = document.createElement('span');
      label.textContent = name;
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      label.style.whiteSpace = 'nowrap';

      const del = styles(document.createElement('button'), {
        type: 'button',
        flex: '0 0 auto',
        width: '22px',
        height: '22px',
        padding: '0',
        border: '0',
        borderRadius: '4px',
        background: 'transparent',
        color: '#adadb8',
        font: '600 13px/1 system-ui, Arial, sans-serif',
        cursor: 'pointer'
      });
      del.textContent = '\u2212';
      del.title = 'Убрать из избранного';
      del.setAttribute('aria-label', 'Убрать из избранного');
      del.addEventListener('click', () => removeFavorite(key));

      li.append(label, del);
      ui.list.append(li);
    }

    renderControl();
  }

  function positionPanel() {
    if (!ui.main || !ui.panel) return;
    const r = ui.main.getBoundingClientRect();
    const width = 290;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    ui.panel.style.left = left + 'px';
    ui.panel.style.top = Math.round(r.bottom + 6) + 'px';
  }

  function openPanel() {
    if (!ui.panel) return;
    renderList();
    positionPanel();
    ui.panel.style.display = 'flex';
    ui.open = true;
    ui.more.setAttribute('aria-expanded', 'true');
  }

  function closePanel() {
    if (!ui.panel || !ui.open) return;
    ui.panel.style.display = 'none';
    ui.open = false;
    if (ui.more) ui.more.setAttribute('aria-expanded', 'false');
  }

  function togglePanel() {
    if (ui.open) closePanel();
    else openPanel();
  }

  /* ============================================================
     6. ОПЕРАЦИИ
     ============================================================ */
  /** Если избранное опустело, фильтр «только избранное» выключаем. */
  function stopEmptyFilter() {
    if (onlyFavorites && !favorites.size) {
      onlyFavorites = false;
      persistFlag();
    }
  }

  function toggleFavorite(name) {
    const key = norm(name);
    if (!key) return;

    if (favorites.has(key)) {
      favorites.delete(key);
      showToast(`Убрано из избранного: ${name}`);
    } else {
      favorites.set(key, name);
      showToast(`В избранном: ${name}`);
    }

    persistFavorites();
    stopEmptyFilter();
    apply();
    renderList();
    log(favorites.has(key) ? 'добавил' : 'убрал', name);
  }

  function removeFavorite(key) {
    if (!favorites.has(key)) return;
    const name = favorites.get(key);
    favorites.delete(key);
    persistFavorites();
    stopEmptyFilter();
    renderList();
    apply();
    showToast(`Убрано из избранного: ${name}`);
  }

  function clearFavorites() {
    if (!favorites.size) return;
    favorites.clear();
    persistFavorites();
    stopEmptyFilter();
    renderList();
    apply();
    showToast('Список избранного очищен');
  }

  function setOnlyFavorites(on) {
    if (on && !favorites.size) {
      showToast('Список пуст — отметьте игры звёздочкой ★');
      openPanel();
      return;
    }
    if (onlyFavorites === !!on) return;
    onlyFavorites = !!on;
    persistFlag();
    apply();
    renderControl();
    log('фильтр только избранное:', onlyFavorites);
  }

  /* ============================================================
     7. ПРИМЕНЕНИЕ К DOM
     ============================================================ */
  function apply() {
    // страница могла перерисоваться и выкинуть нашу вкладку
    if (!ui.wrapper) buildControl();
    mountControl();

    const headers = document.querySelectorAll(HEADER_SEL);
    const placed = [];
    let doneGroups = 0;

    headers.forEach((header) => {
      const name = gameOf(header);
      if (!name) return;

      const fav = isFavorite(name);
      const star = ensureStar(header, name);
      applyStarState(star, fav);
      // не прячем звёздочку из-под курсора, если страница что-то перерисовала
      if (!fav && header.matches(':hover')) {
        star.style.opacity = '1';
        star.style.pointerEvents = 'auto';
      }

      // статистика из инвентаря: сколько наград собрано у этой игры
      const gameId = gameIdFromImg(header.querySelector('img[src*="/ttv-boxart/"]'));
      const game = gameId && stats && stats.games ? stats.games[gameId] : null;
      const parts = partsFor(header);
      const scope = parts.length === 1 ? parts[0] : parts[parts.length - 1];

      // если кампания раскрыта — считаем честно по её наградам и блоку «Получено»
      const claimed = stats && stats.claimed ? stats.claimed : null;
      const names = rewardNamesIn(scope, header);
      const exact = names && claimed
        ? { total: names.length, earned: earnedFromClaimed(names, claimed) || 0 }
        : null;

      // иначе ищем кампанию этой игры по дате окончания из строки
      const rowCampaign = exact ? null : campaignByEnds(gameId, rawText(header));
      const shown = exact || (rowCampaign
        ? { total: rowCampaign.total, earned: rowCampaign.earned }
        : null);

      renderStatsPill(header, name, game, shown);
      if (game && game.allDone) doneGroups++;

      const hide = (onlyFavorites && favorites.size > 0 && !fav)
        || (hideCompleted && game && game.allDone);
      for (const el of parts) setHidden(el, hide);

      // подписываем кампании внутри раскрытой карточки
      renderCampaignPills(header, parts, exact);

      // раскрытая кампания — единственный источник её состава на этой странице,
      // поэтому запоминаем её, чтобы счётчик жил и после сворачивания
      if (names && names.length) {
        rememberOpenCampaign(scope, header, gameId, names, exact);
      }

      placed.push([header, star, star._host]);
    });

    // вторым проходом — только замеры, чтобы не устраивать layout-шторм
    for (const [header, star, host] of placed) fixClippedStar(header, star, host);

    const inventoryDone = applyInventory();
    doneCount = inventoryDone >= 0 ? inventoryDone : doneGroups;

    renderControl();
    renderDone();

    // строки могли дорисоваться позже — тогда обход запустится из apply
    scheduleScanAll();
  }

  /* ============================================================
     8. ИНВЕНТАРЬ ДРОПОВ: отметка «получено» и фильтр готовых
     ============================================================ */
  const CAMPAIGN_SEL = '.inventory-campaign-info';
  const BAR_SEL = '[role="progressbar"]';
  const BADGE_CLASS = 'tak-done-badge';
  const DONE_LI_CLASS = 'tak-done-li';

  /** Тексты кнопок, которые означают «просмотрено, но ещё не забрано». */
  const ACTION_TEXTS = ['получить', 'подключить', 'claim', 'connect'];

  let hideCompleted = false;
  let doneCount = 0;

  /** Корень карточки кампании: .inventory-campaign-info + башня наград рядом. */
  const campaignRoot = (info) => info.parentElement || info;

  /** Название кампании («Osaka 2026 Play-ins»). */
  function campaignName(info) {
    const a = info.querySelector('a[href*="dropID="]');
    return a ? cleanText(a) : '';
  }

  /** Twitch помечает истёкшие награды так — такие полоски в расчёт не берём. */
  const DEAD_REWARD_RE = /больше недоступна/i;

  /** Названия наград нарисованы этим классом и в кампаниях, и в «Получено». */
  const REWARD_NAME_SEL = '.gUQtFU';

  /** В блоке «Получено» у карточки стоит относительное время («3 часа назад»). */
  const CLAIMED_TIME_RE = /назад|ago|только что/i;

  /**
   * Награды, реально полученные по данным блока «Получено»:
   * norm(название) -> количество. Это точнее полосок прогресса: полоска
   * может быть 100%, а награда ещё не забрана.
   */
  function claimedFromPage(root) {
    const claimed = {};

    for (const img of root.querySelectorAll('img.inventory-drop-image')) {
      const card = rewardRowOfImage(img);
      if (!card) continue;

      const texts = [...card.querySelectorAll('p')].map(rawText).filter(Boolean);
      if (!texts.some((text) => CLAIMED_TIME_RE.test(text))) continue;   // не «Получено»

      const name = texts.find((text) => !CLAIMED_TIME_RE.test(text));
      if (!name) continue;

      const badge = [...card.querySelectorAll('div')]
        .map((el) => el.textContent.trim())
        .find((text) => /^\d+$/.test(text));
      const qty = badge ? Number(badge) : 1;

      const key = norm(name);
      claimed[key] = (claimed[key] || 0) + (qty > 0 ? qty : 1);
    }

    return claimed;
  }

  /** Сколько из списка наград реально получено (по названиям, с учётом повторов). */
  function earnedFromClaimed(names, claimed) {
    if (!claimed) return null;
    const pool = Object.assign({}, claimed);
    let earned = 0;

    for (const name of names) {
      const key = norm(name);
      if (pool[key] > 0) {
        pool[key] -= 1;
        earned += 1;
      }
    }

    return earned;
  }

  /**
   * Имя награды в строке башни. Классы Twitch хешированные и на разных
   * страницах разные: в инвентаре это .gUQtFU, на «Все кампании» у <p> другой
   * хеш. Поэтому сначала пробуем известный класс, а иначе берём первый <p>,
   * который не пилюля типа награды, не подпись прогресса и не «недоступна».
   */
  function rewardNameIn(row) {
    const known = row.querySelector(REWARD_NAME_SEL);
    if (known) return rawText(known);

    for (const p of row.querySelectorAll('p')) {
      if (p.closest('.tw-pill')) continue;         // «Игровой предмет» — тип, не название
      const text = rawText(p);
      if (!text) continue;
      if (DEAD_REWARD_RE.test(text)) continue;     // «Эта награда больше недоступна.»
      if (text.charAt(0) === '%') continue;        // «% от 1 час 100»
      return text;
    }

    return '';
  }

  /** Названия наград башни: по одному на строку, в порядке разметки. */
  function rewardNamesInTower(tower, header) {
    const names = [];
    for (const row of tower.children) {
      if (header && header.contains(row)) continue;
      const text = rewardNameIn(row);
      if (text) names.push(text);
    }
    return names;
  }

  /** Названия наград в раскрытом блоке кампании (без шапки). */
  function rewardNamesIn(scope, header) {
    if (!scope || scope === header) return null;

    const names = [];
    for (const tower of scope.querySelectorAll('.tw-tower')) {
      names.push(...rewardNamesInTower(tower, header));
    }

    return names.length ? names : null;
  }

  /**
   * Строка награды вокруг элемента: поднимаемся вверх, пока на этом уровне
   * ровно одна полоска прогресса, и останавливаемся на блоке с картинкой.
   */
  function rewardRowOf(el) {
    let node = el;
    while (node && node.parentElement) {
      const parent = node.parentElement;
      if (parent.querySelectorAll(BAR_SEL).length > 1) break;
      node = parent;
      if (node.querySelector && node.querySelector('img.inventory-drop-image')) return node;
    }
    return node;
  }

  /**
   * Награда больше недоступна — только по явной подписи Twitch.
   * Затемнение (inventory-opacity-2) признаком не является: оно же стоит
   * на обычных недособранных наградах.
   */
  function isDeadReward(row) {
    return !!row && DEAD_REWARD_RE.test(row.textContent);
  }

  /** Строка награды по её картинке: поднимаемся, пока видим одну картинку. */
  function rewardRowOfImage(img) {
    let node = img;
    while (node.parentElement) {
      const parent = node.parentElement;
      if (parent.querySelectorAll('img.inventory-drop-image').length > 1) break;
      node = parent;
      if (node.querySelector(BAR_SEL)) return node;
    }
    return node;
  }

  /** id игры из ссылки на обложку: .../ttv-boxart/460630-285x380.jpg -> 460630. */
  function gameIdFromImg(img) {
    const src = (img && img.getAttribute('src')) || '';
    const match = /\/ttv-boxart\/([^-]+)-/.exec(src);
    return match ? match[1] : '';
  }

  /** Есть ли внутри блока кнопка «Получить»/«Подключить». */
  const hasAction = (scope) => [...scope.querySelectorAll('[data-a-target="tw-core-button-label-text"]')]
    .some((el) => ACTION_TEXTS.includes(norm(el.textContent)));

  /** Собрано ли награда: 100% на полоске, либо полоску уже убрали (получено). */
  function rewardEarned(img) {
    const row = rewardRowOfImage(img);
    if (!row || isDeadReward(row)) return false;
    const bar = row.querySelector(BAR_SEL);
    if (!bar) return true;                                   // полоски нет — уже получено
    const value = Number(bar.getAttribute('aria-valuenow'));
    return Number.isFinite(value) && value >= 100;
  }

  /**
   * Состояние кампании:
   *   watched — все ЖИВЫЕ полоски прогресса на 100% (истёкшие не считаем:
   *             85%, 56%, 42% под «больше недоступна» не досмотреть уже никак);
   *   pending — остались кнопки «Получить» / «Подключить» у живых наград;
   *   done    — смотреть больше нечего и забирать нечего.
   */
  function scanCampaign(info, claimed) {
    const root = campaignRoot(info);

    const bars = [...root.querySelectorAll(BAR_SEL)]
      .map((el) => ({ value: Number(el.getAttribute('aria-valuenow')), row: rewardRowOf(el) }))
      .filter((bar) => Number.isFinite(bar.value));

    const live = bars.filter((bar) => !isDeadReward(bar.row));
    const dead = bars.length - live.length;

    const towers = [...root.querySelectorAll('.tw-tower')];
    const names = towers.length
      ? towers.reduce((all, tower) => all.concat(rewardNamesInTower(tower)), [])
      : [...root.querySelectorAll(REWARD_NAME_SEL)].map(rawText).filter(Boolean);
    const images = [...root.querySelectorAll('img.inventory-drop-image')];

    const total = names.length || images.length;

    // у живой кампании полоски точнее (они знают, что уже забрано),
    // у завершённой полосок нет — сверяемся со списком «Получено»
    const byClaim = earnedFromClaimed(names, claimed);
    const byProgress = images.filter(rewardEarned).length;
    const earned = live.length
      ? byProgress
      : (byClaim != null && names.length ? byClaim : byProgress);

    // кнопки уровня кампании (например «Подключить» аккаунт) + кнопки живых наград
    const pending = hasAction(info) || live.some((bar) => hasAction(bar.row));

    const incomplete = live.filter((bar) => bar.value < 100);
    const watched = incomplete.length === 0;   // нет живых полосок — смотреть нечего

    return {
      root,
      watched,
      pending,
      live: live.length,
      dead,
      total,
      earned,
      names,
      hasRewards: total > 0,
      progress: incomplete.length ? Math.max(...incomplete.map((bar) => bar.value)) : 100,
      done: watched && !pending
    };
  }

  const BADGE_LOOK = {
    done: { text: '✓ Получено', color: '#00d59b', background: 'rgba(0,177,127,.16)' },
    claim: { text: 'Забрать', color: '#ffd166', background: 'rgba(255,209,102,.16)' },
    expired: { text: 'Недоступно', color: '#adadb8', background: 'rgba(255,255,255,.10)' },
    progress: { text: '', color: '#adadb8', background: 'rgba(255,255,255,.10)' }
  };

  /** Пилюля-отметка сразу после названия кампании. */
  function campaignBadge(info) {
    const link = info.querySelector('a[href*="dropID="]');
    const host = link && link.closest('p');
    if (!host) return null;

    let badge = host.querySelector('.' + BADGE_CLASS);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = BADGE_CLASS;
      Object.assign(badge.style, {
        display: 'inline-block',
        margin: '0 0 0 8px',
        padding: '0 7px',
        border: '0',
        borderRadius: '9px',
        font: '600 11px/18px system-ui, "Segoe UI", Roboto, Arial, sans-serif',
        whiteSpace: 'nowrap',
        verticalAlign: 'middle'
      });
      link.insertAdjacentElement('afterend', badge);
    }
    return badge;
  }

  function setCampaignHidden(el, on) {
    if (on) {
      if (el.dataset.takDoneHidden !== '1') {
        el.dataset.takDonePrev = el.style.display || '';
        el.dataset.takDoneHidden = '1';
      }
      if (el.style.display !== 'none') el.style.display = 'none';
    } else if (el.dataset.takDoneHidden === '1') {
      el.style.display = el.dataset.takDonePrev || '';
      delete el.dataset.takDoneHidden;
      delete el.dataset.takDonePrev;
    }
  }

  /** Текст «Дата окончания» карточки инвентаря — ключ для сопоставления строк. */
  function campaignEnds(info) {
    const line = [...info.querySelectorAll('p')].find((el) => /Дата окончания/i.test(el.textContent));
    if (!line) return '';

    const spans = [...line.querySelectorAll('span')];
    const raw = spans.length ? rawText(spans[spans.length - 1]) : rawText(line);
    return norm(raw.replace(/^.*?:\s*/, ''));
  }

  /**
   * Ищет кампанию этой игры по дате окончания, которая видна в строке
   * «Все кампании». Так счётчик в шапке относится к той кампании на экране,
   * а не к сумме всех кампаний игры.
   */
  function campaignByEnds(gameId, headerText) {
    if (!stats || !stats.campaigns || !gameId || !headerText) return null;
    const haystack = norm(headerText);
    if (!haystack) return null;

    for (const campaign of Object.values(stats.campaigns)) {
      if (campaign.gameId !== gameId || !campaign.ends) continue;
      if (haystack.indexOf(campaign.ends) !== -1) return campaign;
    }
    return null;
  }

  /**
   * Считает статистику по набору карточек инвентаря (живых или распарсенных
   * из HTML). Ничего не рисует — рендер отдельно в applyInventory.
   */
  function measureAll(infos, claimed) {
    const campaigns = {};
    let done = 0;

    infos.forEach((info) => {
      const state = scanCampaign(info, claimed);
      if (state.done) done++;

      // название кампании — ключ кэша и подпись на «Все кампании»
      const link = info.querySelector('a[href*="dropID="]');
      const title = link ? rawText(link) : '';
      const key = norm(title);
      if (!key) return;

      campaigns[key] = {
        title,
        gameId: gameIdFromImg(info.querySelector('img[class*="inventory-boxart"], img[src*="/ttv-boxart/"]')),
        ends: campaignEnds(info),
        total: state.total,
        earned: state.earned,
        done: state.done,
        names: state.names
      };
    });

    return { campaigns, done };
  }

  /** Сводка по играм из кэша кампаний. */
  function deriveGames(campaigns) {
    const games = {};

    for (const key of Object.keys(campaigns)) {
      const campaign = campaigns[key];
      if (!campaign || !campaign.gameId) continue;

      const game = games[campaign.gameId] ||
        (games[campaign.gameId] = { total: 0, earned: 0, campaigns: 0, doneCampaigns: 0, name: '' });

      game.total += campaign.total || 0;
      game.earned += campaign.earned || 0;
      game.campaigns += 1;
      if (campaign.done) game.doneCampaigns += 1;
      if (!game.name) game.name = campaign.title;
    }

    Object.values(games).forEach((game) => {
      game.allDone = game.campaigns > 0 && game.doneCampaigns === game.campaigns;
    });

    return games;
  }

  /** Отпечаток набора наград: сменились названия — это уже другая кампания. */
  function hashNames(names) {
    const text = (names || []).map(norm).sort().join('|');
    let hash = 5381;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    return String(hash >>> 0);
  }

  /** Сколько дней держим кампанию в кэше, если её больше не видно в инвентаре. */
  const CACHE_TTL = 14 * 24 * 60 * 60 * 1000;

  /**
   * Сливает свежие измерения с кэшем.
   * Инвентарь пагинируется («Загрузить еще»), поэтому кампании, которых нет
   * на текущей странице, НЕ выбрасываем — иначе счётчики пропадают, хотя
   * награды уже собраны. Для невидимых обновляем только «получено» по списку
   * «Получено», а полные данные остаются с последнего визита.
   */
  function mergeCampaigns(fresh, claimed) {
    const now = Date.now();
    const campaigns = Object.assign({}, (stats && stats.campaigns) || {});

    for (const key of Object.keys(fresh || {})) {
      const item = fresh[key];
      const prev = campaigns[key];
      const fp = hashNames(item.names);

      // названия наград поменялись — счётчики новые, старые не смешиваем
      if (prev && prev.fp && prev.fp !== fp) {
        campaigns[key] = { ...item, fp, at: now };
        continue;
      }
      campaigns[key] = { ...item, fp, at: now };
    }

    for (const key of Object.keys(campaigns)) {
      const campaign = campaigns[key];
      if (fresh && fresh[key]) continue;

      if (Array.isArray(campaign.names) && campaign.names.length) {
        const byClaim = earnedFromClaimed(campaign.names, claimed);
        if (byClaim != null) {
          campaign.earned = byClaim;
          if (byClaim >= campaign.total && campaign.total > 0) campaign.done = true;
        }
      }

      if (!campaign.at || now - campaign.at > CACHE_TTL) delete campaigns[key];
    }

    return campaigns;
  }

  /**
   * Проставить отметки всем кампаниям на странице инвентаря и сохранить
   * статистику для страницы «Все кампании».
   * Возвращает число полностью готовых кампаний или -1, если инвентаря нет.
   */
  function applyInventory() {
    const infos = document.querySelectorAll(CAMPAIGN_SEL);
    if (!infos.length) return -1;

    // список «Получено» — источник правды о том, что реально забрали;
    // он тоже пагинируется, поэтому копим его между визитами
    const claimed = mergeClaimed(claimedFromPage(document));
    const measured = measureAll(infos, claimed);

    infos.forEach((info) => {
      const state = scanCampaign(info, claimed);

      const badge = campaignBadge(info);
      if (badge) {
        const key = !state.watched
          ? 'progress'
          : state.pending
            ? 'claim'
            : state.live === 0 && state.dead > 0
              ? 'expired'
              : 'done';
        const look = BADGE_LOOK[key];
        const text = key === 'progress' ? state.progress + '%' : look.text;

        setText(badge, text);
        badge.style.color = look.color;
        badge.style.background = look.background;
        badge.title = key === 'progress'
          ? `Не досмотрено до конца, ближайшая награда на ${state.progress}%`
          : key === 'claim'
            ? 'Просмотр завершён, но награду ещё нужно забрать'
            : key === 'expired'
              ? 'Все награды кампании истекли — смотреть больше нечего'
              : state.dead > 0
                ? 'Получено; часть наград уже истекла и в расчёт не идёт'
                : 'Все награды кампании получены';
      }

      setCampaignHidden(state.root, hideCompleted && state.done);
    });

    const merged = mergeCampaigns(measured.campaigns, claimed);
    saveStats(merged, claimed);

    log(`инвентарь: на странице ${Object.keys(measured.campaigns).length} кампаний, ` +
      `в кэше ${Object.keys(merged).length}, «Получено» ${Object.keys(claimed).length}`);

    // если список обрезан пагинацией — дочитываем, иначе половина игр без счётчиков
    expandInventory();

    return measured.done;
  }

  /**
   * Запоминает кампанию, которую пользователь раскрыл на «Все кампании»:
   * список её наград есть только в раскрытом блоке, а счётчик должен жить
   * и после сворачивания/перезагрузки.
   */
  /**
   * Дата окончания из строки «Все кампании»: «ср, 21 окт., 15:00 -
   * ср, 11 нояб., 14:59 GMT+3» → «ср, 11 нояб., 14:59 gmt+3». По ней строка
   * находит свою кампанию в кэше и больше не раскрывается повторно.
   */
  function endsFromHeader(header) {
    const text = rawText(header);
    const index = text.lastIndexOf(' - ');
    return index === -1 ? '' : norm(text.slice(index + 3));
  }

  function rememberOpenCampaign(scope, header, gameId, names, exact) {
    const titleEl = scope && scope.querySelector ? scope.querySelector('strong') : null;
    const title = titleEl && !header.contains(titleEl) ? rawText(titleEl) : '';
    if (!title) return;

    const key = norm(title);
    if (!key) return;

    const fp = hashNames(names);
    const current = stats && stats.campaigns ? stats.campaigns[key] : null;
    const earned = exact ? exact.earned : 0;

    // не перетираем более полные данные той же кампании
    if (current && current.fp === fp && (current.earned || 0) >= earned) return;

    const campaigns = Object.assign({}, (stats && stats.campaigns) || {});
    campaigns[key] = {
      title,
      gameId: current && current.gameId ? current.gameId : gameId,
      ends: current && current.ends ? current.ends : endsFromHeader(header),
      total: names.length,
      earned,
      done: names.length > 0 && earned >= names.length,
      names,
      fp,
      at: Date.now()
    };

    saveStats(campaigns, stats && stats.claimed);
  }

  /* ------------------------------------------------------------
     Один раз за визит проходим по всем строкам «Все кампании»:
     раскрываем, читаем состав наград, запоминаем и сворачиваем.
     Иначе у игр, которых нет в инвентаре, счётчика не будет никогда.
     ------------------------------------------------------------ */
  let scanning = false;

  /** Пока мы сами кликаем по строкам, мутации от этого клика игнорируем. */
  let muting = 0;

  /**
   * Строки, которые уже пробовали читать за этот визит. Без этого нечитаемая
   * строка (сменилась разметка, нет доступа к наградам) ставилась в очередь
   * снова и снова: apply -> scheduleScanAll -> scanRow -> mutation -> apply.
   */
  const probed = new Set();

  const rowKey = (header) => (gameIdFromImg(header.querySelector('img[src*="/ttv-boxart/"]')) || gameOf(header))
    + '|' + endsFromHeader(header);

  function detailsNames(header) {
    return rewardNamesIn(partsFor(header)[0], header);
  }

  async function waitForDetails(header, attempts) {
    const limit = attempts || 20;
    for (let i = 0; i < limit; i++) {
      if (detailsNames(header)) return true;
      await sleep(100);
    }
    return false;
  }

  /** Нужно ли раскрывать строку: она в избранном и данных о кампании ещё нет. */
  function rowNeedsScan(header) {
    // категории читаем только по избранным играм
    if (!isFavorite(gameOf(header))) return false;
    if (probed.has(rowKey(header))) return false;           // уже пробовали в этом визите
    if (detailsNames(header)) return false;                 // уже раскрыта
    const gameId = gameIdFromImg(header.querySelector('img[src*="/ttv-boxart/"]'));
    if (!gameId) return false;
    return !campaignByEnds(gameId, rawText(header));
  }

  /** Строка ещё на экране (или чуть ниже/выше) — только такие и трогаем. */
  function nearViewport(el) {
    const rect = el.getBoundingClientRect();
    return rect.bottom > -300 && rect.top < window.innerHeight + 300;
  }

  /** Быстрое чтение одной категории: раскрыть, прочитать, свернуть. */
  async function scanRow(header) {
    if (!header.isConnected || !rowNeedsScan(header)) return false;

    // даже при неудаче второй раз эту строку в этом визите не трогаем
    probed.add(rowKey(header));

    const button = header.querySelector('button[aria-expanded]');
    if (!button || button.getAttribute('aria-expanded') === 'true') return false;

    // пока раскрываем/сворачиваем сами — не считаем это поводом для нового apply
    let ok = false;
    muting++;
    try {
      button.click();
      await waitForDetails(header, 10);

      const scope = partsFor(header)[0];
      const names = rewardNamesIn(scope, header);
      const gameId = gameIdFromImg(header.querySelector('img[src*="/ttv-boxart/"]'));

      if (names && names.length) {
        const claimed = stats && stats.claimed ? stats.claimed : null;
        const earned = claimed ? (earnedFromClaimed(names, claimed) || 0) : 0;
        rememberOpenCampaign(scope, header, gameId, names, { total: names.length, earned });
        ok = true;
      }
    } finally {
      if (button.getAttribute('aria-expanded') === 'true') button.click();  // вернуть как было
      muting--;
    }

    return ok;
  }

  /* ------------------------------------------------------------
     Очередь чтения: строка попадает в неё, когда оказывается на экране.
     Список у Twitch скроллится внутри контейнера, поэтому событие scroll
     до window не доходит — используем IntersectionObserver.
     ------------------------------------------------------------ */
  let rowObserver = null;
  const scanQueue = [];
  let queueRunning = false;

  function ensureRowObserver() {
    if (rowObserver || typeof IntersectionObserver !== 'function') return;
    rowObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (!rowNeedsScan(entry.target)) continue;
        enqueueRow(entry.target);
      }
    }, { rootMargin: '300px' });
  }

  /** Подписываемся на все строки, которые ещё не наблюдаем. */
  function observeRows() {
    ensureRowObserver();
    if (!rowObserver) return;

    for (const header of document.querySelectorAll(HEADER_SEL)) {
      if (header.dataset.takObs === '1') continue;
      header.dataset.takObs = '1';
      rowObserver.observe(header);
    }
  }

  function enqueueRow(header) {
    if (scanQueue.indexOf(header) !== -1) return;
    scanQueue.push(header);
    runQueue();
  }

  async function runQueue() {
    if (queueRunning) return;
    if (scanning) return;          // идёт полный обход — не мешаем

    queueRunning = true;
    let scanned = 0;

    while (scanQueue.length) {
      const header = scanQueue.shift();
      if (!header.isConnected || !rowNeedsScan(header)) continue;

      try {
        if (await scanRow(header)) scanned++;
      } catch (e) {
        log('строка не прочиталась', e);
      }
      await sleep(120);
    }

    queueRunning = false;
    if (scanned) {
      log(`прочитал по мере прокрутки: ${scanned}`);
      apply();
    }
  }

  /** Полный проход по всем строкам — только вручную, с прогрессом. */
  async function scanAllRows() {
    if (scanning) return;
    if (!onDropsPage() || document.querySelector(CAMPAIGN_SEL)) return;

    probed.clear();                // ручной обход — единственный способ перечитать строки

    const rows = [...document.querySelectorAll(HEADER_SEL)].filter((header) => rowNeedsScan(header));
    if (!rows.length) {
      showToast('Все избранные категории уже в кэше');
      return;
    }

    scanning = true;
    let scanned = 0;

    log(`полный обход: ${rows.length} категорий`);

    try {
      for (let i = 0; i < rows.length; i++) {
        if (await scanRow(rows[i])) scanned++;
        if (i % 10 === 0) showToast(`Обход: ${i + 1} из ${rows.length}`);
        await sleep(120);
      }
    } catch (e) {
      log('полный обход прерван', e);
    }

    scanning = false;
    log(`собрал данные по ${scanned} категориям`);
    showToast(`Готово: ${scanned} категорий`);
    apply();
  }

  /** Подписываемся на строки и сразу ставим в очередь те, что на экране. */
  function scheduleScanAll() {
    if (!onDropsPage() || document.querySelector(CAMPAIGN_SEL)) return;

    observeRows();

    // страховка на случай, если IntersectionObserver ещё не сработал
    for (const header of [...document.querySelectorAll(HEADER_SEL)].filter(nearViewport)) {
      if (rowNeedsScan(header)) enqueueRow(header);
    }
  }

  /** Список «Получено» тоже листается: храним максимум по каждому названию. */
  function mergeClaimed(fresh) {
    const base = Object.assign({}, (stats && stats.claimed) || {});
    for (const key of Object.keys(fresh || {})) {
      base[key] = Math.max(base[key] || 0, fresh[key] || 0);
    }
    return base;
  }

  /**
   * Отпечаток кэша без времени: у каждой кампании есть свой at, и с ним любой
   * проход выглядит новым — storage.set срабатывал на каждый apply, а его
   * onChanged снова вызывал apply (вечный цикл на странице инвентаря).
   */
  function withoutAt(campaigns) {
    const out = {};
    for (const key of Object.keys(campaigns || {})) {
      const copy = Object.assign({}, campaigns[key]);
      delete copy.at;
      out[key] = copy;
    }
    return out;
  }

  /** Сохраняем статистику только когда она реально изменилась. */
  function saveStats(campaigns, claimed) {
    const games = deriveGames(campaigns);
    const payload = { at: Date.now(), games, campaigns, claimed: claimed || (stats && stats.claimed) || {} };
    stats = payload;

    // время меняется всегда, поэтому сравниваем только данные
    const snapshot = JSON.stringify({ campaigns: withoutAt(campaigns), claimed: payload.claimed });
    if (snapshot === statsSaved) return;
    statsSaved = snapshot;
    storage.set(STATS_KEY, payload);
  }

  /* ------------------------------------------------------------
     Инвентарь пагинируется («Загрузить еще»), поэтому в кэш попадает
     только первая страница. Один раз за визит догружаем остальные,
     чтобы счётчики были по всем играм, а не по первым пяти.
     ------------------------------------------------------------ */
  const LOAD_MORE_RE = /загрузить\s*ещ|load\s*more|show\s*more/i;
  const MAX_EXPAND_CLICKS = 8;

  let expandTried = false;
  let expanding = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Кнопка «Загрузить еще» — ищем по тексту, а не по хэшам классов. */
  function loadMoreButton() {
    const candidates = [...document.querySelectorAll('button, a, [role="button"]')];
    for (const el of candidates) {
      const text = norm(el.textContent);
      if (!text || text.length > 40) continue;
      if (!LOAD_MORE_RE.test(text)) continue;
      if (!el.getClientRects().length) continue;      // скрытые не считаем
      return el;
    }
    return null;
  }

  async function expandInventory() {
    if (expanding || expandTried) return;
    if (!document.querySelector(CAMPAIGN_SEL)) return;   // это не инвентарь

    expanding = true;
    expandTried = true;

    const before = document.querySelectorAll(CAMPAIGN_SEL).length;
    let clicks = 0;

    try {
      while (clicks < MAX_EXPAND_CLICKS) {
        const button = loadMoreButton();
        if (!button) break;

        button.click();
        clicks++;
        await sleep(900);

        if (!loadMoreButton()) break;
      }
    } catch (e) {
      log('догрузка инвентаря не удалась', e);
    }

    expanding = false;

    const after = document.querySelectorAll(CAMPAIGN_SEL).length;
    log(`догрузка инвентаря: нажатий ${clicks}, кампаний ${before} → ${after}`);

    if (after !== before) apply();
  }

  /**
   * Страница «Все кампании» сама прогресса не знает, поэтому при отсутствии
   * кэша подтягиваем HTML инвентаря тем же запросом, что и браузер, и парсим.
   * Если Twitch отдал пустую SPA-оболочку, тихо ничего не делаем.
   */
  /* ------------------------------------------------------------
     GraphQL: перехватываем операцию инвентаря, которую делает сама
     страница, и учимся понимать её ответ. Если ответ совпадает с тем,
     что видно в DOM, — запоминаем, что схеме можно верить, и дальше
     запрашиваем данные напрямую, без захода в инвентарь.
     ------------------------------------------------------------ */
  const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1i5o';

  const num = (value) => (typeof value === 'number' && isFinite(value) ? value : null);

  /** Прогресс одной награды в процентах, из любого правдоподобного поля. */
  function dropPercent(drop) {
    if (!drop || typeof drop !== 'object') return null;

    for (const key of ['progress', 'currentProgress', 'percent', 'percentage']) {
      const value = num(drop[key]);
      if (value != null) return value;
    }

    const nested = drop.dropProgress || drop.progressInfo;
    if (nested && typeof nested === 'object') {
      const current = num(nested.currentProgress);
      if (current != null) return current;
      const progress = num(nested.progress);
      if (progress != null) return progress;
    }

    const watched = num(drop.currentMinutesWatched);
    const required = num(drop.requiredMinutesWatched);
    if (watched != null && required) return Math.min(100, Math.round((watched / required) * 100));

    return null;
  }

  const idFromUrl = (url) => {
    const match = /\/ttv-boxart\/([^-]+)-/.exec(String(url || ''));
    return match ? match[1] : '';
  };

  /**
   * Достаёт статистику из JSON GraphQL, не привязываясь к точным именам
   * контейнеров: ищет объекты «кампания с массивом наград». Если структура
   * не наша — возвращает null, и остаётся разбор HTML.
   */
  function mapInventoryJson(json) {
    const campaigns = {};
    const games = {};
    let found = 0;

    const collect = (campaign) => {
      const drops = campaign.drops;
      const percents = drops.map(dropPercent).filter((p) => p != null);
      if (!percents.length) return;

      const title = campaign.name;
      const key = norm(title);
      if (!key) return;

      const total = drops.length;
      const earned = percents.filter((p) => p >= 100).length;
      const game = campaign.game || {};
      const gameId = String(game.id || '') || idFromUrl(game.boxArtURL || campaign.boxArtURL);

      found++;
      campaigns[key] = {
        title,
        gameId,
        total,
        earned,
        done: earned >= total,
        names: drops.map((drop) => (drop && typeof drop.name === 'string' ? drop.name : '')).filter(Boolean)
      };
    };

    const visit = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 14) return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item, depth + 1);
        return;
      }
      if (typeof node.name === 'string' && Array.isArray(node.drops) && node.drops.length) {
        collect(node);
        return;
      }
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (value && typeof value === 'object') visit(value, depth + 1);
      }
    };

    visit(json, 0);
    if (!found) return null;

    return { campaigns };
  }

  /** Насколько разбор GraphQL сходится с тем, что видно на странице. */
  function crossCheck(domCampaigns, gqlCampaigns) {
    let same = 0;
    let total = 0;
    for (const key of Object.keys(gqlCampaigns)) {
      const dom = domCampaigns[key];
      if (!dom) continue;
      total++;
      if (dom.earned === gqlCampaigns[key].earned && dom.total === gqlCampaigns[key].total) same++;
    }
    return total ? same / total : 0;
  }

  /** Ответ перехваченного GraphQL-запроса. */
  function onGqlPayload(event) {
    if (event.source !== window) return;
    const payload = event.data && event.data.__takGql;
    if (!payload || !payload.op) return;

    // интересует только инвентарь: под «drops» подходят и дашборд, и кампании
    if (!/inventory/i.test(String(payload.op))) return;

    const mapped = mapInventoryJson(payload.data);
    if (!mapped) {
      log('GraphQL: ответ не распознан', payload.op);
      return;
    }

    // операцию запоминаем только если её ответ действительно разобрался,
    // иначе можно потом повторить чужой запрос
    if (payload.hash) {
      gqlOp = { op: payload.op, hash: payload.hash, vars: payload.vars || null, at: Date.now() };
      storage.set(GQL_OP_KEY, gqlOp);
    }

    if (!document.querySelector(CAMPAIGN_SEL)) return;

    // на инвентаре есть DOM — сверяем и только потом доверяем схеме
    const dom = measureAll(document.querySelectorAll(CAMPAIGN_SEL), claimedFromPage(document));
    const rate = crossCheck(dom.campaigns, mapped.campaigns);
    log(`GraphQL: ${payload.op}, кампаний ${Object.keys(mapped.campaigns).length}, совпадение с DOM ${Math.round(rate * 100)}%`);

    if (rate >= 0.7) {
      gqlOk = true;
      storage.set(GQL_OK_KEY, true);
      saveStats(mergeCampaigns(mapped.campaigns, stats && stats.claimed), stats && stats.claimed);
    }
  }

  /** Повторяем подсмотренный запрос с другой страницы и забираем данные. */
  async function loadStatsViaGql() {
    if (!gqlOk || !gqlOp || !gqlOp.hash) return false;
    try {
      const res = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Client-Id': GQL_CLIENT_ID,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          operationName: gqlOp.op,
          variables: gqlOp.vars || {},
          extensions: { persistedQuery: { version: 1, sha256Hash: gqlOp.hash } }
        })
      });
      if (!res.ok) return false;

      const mapped = mapInventoryJson(await res.json());
      if (!mapped) return false;

      saveStats(mergeCampaigns(mapped.campaigns, stats && stats.claimed), stats && stats.claimed);
      apply();
      log('GraphQL: статистика получена напрямую');
      return true;
    } catch (e) {
      log('GraphQL не ответил', e);
      return false;
    }
  }

  /**
   * Страница «Все кампании» сама прогресса не знает, поэтому при отсутствии
   * кэша сначала пробуем GraphQL (если операцию уже подсмотрели), и только
   * потом — разбор HTML инвентаря.
   */
  async function loadStatsFromInventoryPage() {
    if (stats && stats.games && stats.campaigns) return;
    if (document.querySelector(CAMPAIGN_SEL)) return;      // мы уже на инвентаре
    if (!document.querySelector(HEADER_SEL)) return;       // это не список дропов

    if (await loadStatsViaGql()) return;

    try {
      const res = await fetch('/drops/inventory', { credentials: 'include' });
      if (!res.ok) return;

      const html = await res.text();
      if (html.indexOf('inventory-campaign-info') === -1) return;   // одностраничная оболочка

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const infos = doc.querySelectorAll(CAMPAIGN_SEL);
      if (!infos.length) return;

      const claimed = claimedFromPage(doc);
      const measured = measureAll(infos, claimed);
      saveStats(mergeCampaigns(measured.campaigns, claimed), claimed);
      apply();
      log('статистика подтянута со страницы инвентаря');
    } catch (e) {
      log('не удалось подтянуть инвентарь', e);
    }
  }

  function statsTimeSuffix() {
    if (!stats || !stats.at) return '';
    const when = new Date(stats.at);
    const hh = String(when.getHours()).padStart(2, '0');
    const mm = String(when.getMinutes()).padStart(2, '0');
    return ` (данные инвентаря от ${hh}:${mm})`;
  }

  /**
   * Счётчик «3/5» рядом с названием игры на странице «Все кампании».
   * Данные приходят из инвентаря через chrome.storage.
   */
  /** Общая пилюля-счётчик: создаём/переиспользуем и красим по факту «собрано всё». */
  function ensurePill(host, className, margin) {
    let pill = host.querySelector('.' + className);
    if (!pill) {
      pill = document.createElement('span');
      pill.className = className;
      Object.assign(pill.style, {
        display: 'inline-block',
        margin: margin,
        padding: '0 6px',
        border: '0',
        borderRadius: '9px',
        font: '600 11px/18px system-ui, "Segoe UI", Roboto, Arial, sans-serif',
        whiteSpace: 'nowrap',
        verticalAlign: 'middle'
      });
    }
    if (host.lastElementChild !== pill) host.append(pill);
    return pill;
  }

  function paintPill(pill, total, earned, title) {
    // зелёным — только когда собраны ВСЕ награды; «2/5» зелёным быть не должно
    const all = total > 0 && earned >= total;
    setText(pill, (all ? '\u2713 ' : '') + earned + '/' + total);
    pill.style.color = all ? '#00d59b' : '#adadb8';
    pill.style.background = all ? 'rgba(0,177,127,.16)' : 'rgba(255,255,255,.10)';
    pill.title = title + statsTimeSuffix();
  }

  /**
   * Счётчик «3/5» рядом с названием игры на странице «Все кампании».
   * override — числа, посчитанные прямо по раскрытому блоку (точнее кэша).
   */
  function renderStatsPill(header, name, game, override) {
    const host = nameElementOf(header, name);
    if (!host) return null;

    const data = override || (game && game.total ? game : null);

    let pill = host.querySelector('.' + PILL_CLASS);
    if (!data) {
      if (pill) pill.remove();
      return null;
    }

    pill = ensurePill(host, PILL_CLASS, '0 0 0 6px');
    paintPill(pill, data.total, data.earned, `Собрано ${data.earned} из ${data.total} наград`);
    return pill;
  }

  /**
   * Счётчик рядом с названием самой кампании внутри раскрытой карточки.
   * Если удалось посчитать по блоку «Получено» — подписываем заголовок
   * кампании; иначе ищем известное название кампании из кэша инвентаря.
   */
  function renderCampaignPills(header, parts, override) {
    const scope = parts.length === 1 ? parts[0] : parts[parts.length - 1];
    if (!scope || scope === header) return;

    if (override) {
      const title = scope.querySelector('strong');
      if (title && !header.contains(title)) {
        const pill = ensurePill(title, CAMP_PILL_CLASS, '0 0 0 8px');
        paintPill(pill, override.total, override.earned,
          `Собрано ${override.earned} из ${override.total} наград кампании`);
      }
      return;
    }

    if (!stats || !stats.campaigns) return;

    for (const el of scope.querySelectorAll('strong, p')) {
      if (header.contains(el)) continue;              // шапка уже подписана отдельно
      if (rawText(el).length > 120) continue;         // это абзац, а не заголовок

      const data = stats.campaigns[norm(rawText(el))];
      if (!data || !data.total) continue;

      const pill = ensurePill(el, CAMP_PILL_CLASS, '0 0 0 8px');
      paintPill(pill, data.total, data.earned, `Собрано ${data.earned} из ${data.total} наград кампании`);
    }
  }

  function buildDoneControl() {
    if (ui.doneMain) return;

    const li = document.createElement('li');
    li.className = DONE_LI_CLASS;
    li.setAttribute('role', 'presentation');
    Object.assign(li.style, { display: 'flex', alignItems: 'center', listStyle: 'none', flex: '0 0 auto' });

    const main = styles(document.createElement('button'), {
      type: 'button',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      height: '32px',
      padding: '0 10px',
      border: '0',
      borderRadius: '4px',
      background: 'transparent',
      color: '#efeff1',
      font: FONT,
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    });
    main.className = 'tak-done-main';

    const check = document.createElement('span');
    check.textContent = '\u2713';
    check.style.color = '#00d59b';
    check.style.fontSize = '13px';

    const label = document.createElement('span');
    label.textContent = 'Готово';

    const count = styles(document.createElement('span'), {
      padding: '1px 6px',
      borderRadius: '9px',
      background: 'rgba(255,255,255,0.14)',
      color: '#efeff1',
      font: '600 11px/1.5 system-ui, Arial, sans-serif'
    });
    count.className = 'tak-done-count';
    count.textContent = '0';

    main.append(check, label, count);
    li.append(main);

    ui.doneLi = li;
    ui.doneMain = main;
    ui.doneCount = count;

    main.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideCompleted = !hideCompleted;
      storage.set(DONE_KEY, hideCompleted);
      apply();
      showToast(hideCompleted ? 'Полученные кампании скрыты' : 'Показаны все кампании');
    });
  }

  function renderDone() {
    if (!ui.doneMain) return;
    setText(ui.doneCount, String(doneCount));
    ui.doneMain.style.color = hideCompleted ? '#bf94ff' : '#efeff1';
    ui.doneMain.style.background = hideCompleted ? 'rgba(145,71,255,.16)' : 'transparent';
    ui.doneMain.setAttribute('aria-pressed', hideCompleted ? 'true' : 'false');
    ui.doneMain.title = hideCompleted
      ? 'Показать все кампании'
      : `Скрыть полученные кампании (${doneCount})`;
  }

  /* ============================================================
     9. ТОСТ (на requestAnimationFrame: content.js режет setTimeout)
     ============================================================ */
  let toastEl = null;

  function showToast(text) {
    if (!document.body) return;

    if (!toastEl) {
      toastEl = styles(document.createElement('div'), {
        position: 'fixed',
        left: '50%',
        bottom: '24px',
        transform: 'translateX(-50%)',
        zIndex: '2147483001',
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        border: '1px solid #2f2f35',
        borderRadius: '6px',
        background: '#0e0e10',
        color: '#efeff1',
        boxShadow: '0 6px 20px rgba(0,0,0,.6)',
        font: FONT
      });
      toastEl.className = 'tak-toast';
      document.body.append(toastEl);
    }

    setText(toastEl, text);

    if (toastEl._raf) cancelAnimationFrame(toastEl._raf);
    const until = performance.now() + 4000;
    const tick = () => {
      if (performance.now() >= until) {
        toastEl.style.display = 'none';
        toastEl._raf = 0;
        return;
      }
      toastEl.style.display = 'flex';
      toastEl._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  /* ============================================================
     10. ПЕРЕРИСОВКИ СТРАНИЦЫ
     ============================================================ */
  let applying = false;

  function applySafe() {
    if (applying) return;
    applying = true;
    try {
      apply();
    } catch (e) {
      log('ошибка применения', e);
    } finally {
      applying = false;
    }
  }

  /** Реагируем на карточки, вкладки и инвентарь: чат не грузит CPU. */
  function isRelevant(records) {
    const asElement = (node) => (node.nodeType === 1 ? node : node.parentElement);

    const inHeader = (node) => {
      const el = asElement(node);
      return !!(el && el.closest && el.closest(HEADER_SEL));
    };

    const inCampaign = (node) => {
      let el = asElement(node);
      for (let i = 0; el && i < 6; i++, el = el.parentElement) {
        if (el.closest && el.closest(CAMPAIGN_SEL)) return true;
        if (el.querySelector && el.querySelector(':scope > ' + CAMPAIGN_SEL)) return true;
      }
      return false;
    };

    const marker = (node) => {
      if (!node || node.nodeType !== 1) return false;
      return node.matches(HEADER_SEL)
        || node.matches('ul[role="tablist"]')
        || node.matches(CAMPAIGN_SEL)
        || node.matches('img.inventory-drop-image')
        || node.matches(REWARD_NAME_SEL)
        || !!node.querySelector(HEADER_SEL)
        || !!node.querySelector('ul[role="tablist"]')
        || !!node.querySelector(CAMPAIGN_SEL)
        || !!node.querySelector('img.inventory-drop-image')
        || !!node.querySelector(REWARD_NAME_SEL)
        || !!node.querySelector('.tw-tower');
    };

    for (const record of records) {
      if (record.type === 'attributes') {
        // полоска прогресса: 46% -> 100% без перерисовки карточки
        if (record.target && record.target.matches && record.target.matches(BAR_SEL)) return true;
        continue;
      }

      for (const node of record.addedNodes) {
        if (inHeader(node) || inCampaign(node)) return true;
        if (marker(node)) return true;
      }
      for (const node of record.removedNodes) {
        if (node.nodeType === 1 && node.classList && node.classList.contains(STAR_CLASS)) return true;
        if (node.nodeType === 1 && node.classList && node.classList.contains(BADGE_CLASS)) return true;
        if (marker(node)) return true;
      }
    }
    return false;
  }

  function watchDom() {
    const target = document.body || document.documentElement;
    if (!target) return;
    const observer = new MutationObserver((records) => {
      // свои клики по строкам и свои же правки — не повод запускать всё заново
      if (applying || muting) return;
      if (!isRelevant(records)) return;
      applySafe();
    });
    // attributes: только aria-valuenow — прогресс дропа меняется без перерисовки
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-valuenow']
    });
  }

  /* ============================================================
     11. СИНХРОНИЗАЦИЯ МЕЖДУ ВКЛАДКАМИ
     ============================================================ */
  function watchStorage() {
    try {
      const onChanged = globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.onChanged;
      if (!onChanged) return;
      onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes) return;

        if (changes[FAV_KEY]) {
          const list = changes[FAV_KEY].newValue || [];
          favorites.clear();
          for (const name of list) if (typeof name === 'string' && norm(name)) favorites.set(norm(name), name);
          renderList();
          apply();
        }
        if (changes[FLAG_KEY]) {
          onlyFavorites = !!changes[FLAG_KEY].newValue;
          apply();
          renderControl();
        }
        if (changes[DONE_KEY]) {
          hideCompleted = !!changes[DONE_KEY].newValue;
          apply();
          renderDone();
        }
        if (changes[STATS_KEY]) {
          // инвентарь обновил статистику в другой вкладке
          const next = changes[STATS_KEY].newValue;
          if (next && next.games) {
            stats = next;
            statsSaved = JSON.stringify({ campaigns: withoutAt(next.campaigns || {}), claimed: next.claimed || {} });
            apply();
          }
        }
      });
    } catch (e) {
      log('синхронизация вкладок недоступна', e);
    }
  }

  /* ============================================================
     12. СТАРТ
     ============================================================ */
  async function init() {
    const list = await storage.get(FAV_KEY);
    favorites.clear();
    if (Array.isArray(list)) {
      for (const name of list) if (typeof name === 'string' && norm(name)) favorites.set(norm(name), name);
    }

    const flag = await storage.get(FLAG_KEY);
    onlyFavorites = !!flag;

    hideCompleted = !!(await storage.get(DONE_KEY));

    const savedStats = await storage.get(STATS_KEY);
    if (savedStats && savedStats.games) {
      // запись без отпечатка наград — из старой версии, ей верить нельзя
      const campaigns = {};
      for (const key of Object.keys(savedStats.campaigns || {})) {
        const campaign = savedStats.campaigns[key];
        if (campaign && campaign.fp) campaigns[key] = campaign;
      }

      stats = {
        at: savedStats.at,
        campaigns,
        games: deriveGames(campaigns),
        claimed: savedStats.claimed || {}
      };
      statsSaved = JSON.stringify({ campaigns: withoutAt(stats.campaigns), claimed: stats.claimed });
    }

    gqlOk = !!(await storage.get(GQL_OK_KEY));
    const savedOp = await storage.get(GQL_OP_KEY);
    if (savedOp && savedOp.hash) gqlOp = savedOp;

    buildControl();
    if (!started) {
      started = true;
      watchDom();
      watchStorage();
      window.addEventListener('message', onGqlPayload);
    }
    apply();
    renderList();

    // на «Все кампании» прогресса нет — подтянем его со страницы инвентаря
    loadStatsFromInventoryPage();

    // и доберём категории, по которым данных ещё нет (один раз за визит)
    scheduleScanAll();

    const cacheInfo = stats
      ? `кэш: кампаний ${Object.keys(stats.campaigns || {}).length}, игр ${Object.keys(stats.games || {}).length}, ` +
        `получено ${Object.keys(stats.claimed || {}).length}, обновлён ${stats.at ? new Date(stats.at).toLocaleString() : '—'}`
      : 'кэша нет — открой /drops/inventory';

    log(`[${BUILD}] готово, избранных игр: ${favorites.size}, фильтр: ${onlyFavorites}, ` +
      `скрывать полученные: ${hideCompleted}; ${cacheInfo}`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // для отладки/тестов из изолированного мира расширения
  globalThis.__twitchAliveFav = {
    favorites,
    apply,
    init,
    renderList,
    toggleFavorite,
    setOnlyFavorites,
    scanCampaign,
    isOnlyFavorites: () => onlyFavorites,
    isHidingCompleted: () => hideCompleted,
    completedCount: () => doneCount
  };
})();
