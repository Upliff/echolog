/* Echolog front end. Plain JS, no build step. Reads data/stories.json. */
(() => {
  'use strict';

  /* ---------- settings ---------- */

  const DATA_URL = 'data/stories.json';
  const COVER_DIR = 'covers/';
  const COVER_EXTS = ['jpg', 'jpeg', 'png', 'webp'];

  // Clouds drift over the video itself. YouTube's embed rules don't allow anything on top of the
  // player, so this breaks them. Set to false to keep clouds beside the video instead
  // (the video then settles back a little on desktop to make room).
  const CLOUDS_OVER_VIDEO = true;

  // Clouds only show while the clip is playing and the video is big.
  const CLOUD_FIRST_MS = 6000;   // wait this long after the clip starts before the first one
  const CLOUD_GAP_MS = 1500;     // pause between one cloud starting to fade and the next one
  const CLOUD_MAX_CHARS = 200;   // longer comments stay in the list, where they get "Show more"
  const CLOUD_MAX = 2;           // at most this many on screen at once (phones: 1)

  // Defaults. The admin page can change these for everyone (config/games.json "settings").
  const DEFAULTS = {
    volume: 80,         // how loud a song starts (0 to 100) if it has no volume of its own; a visitor's choice is remembered per song
    upNextSeconds: 8,   // "Next: ..." shows this long before a song ends, then the next song starts. 0 = off
  };

  // Background detail: the cover is drawn this many pixels across, then stretched.
  // Smaller is blurrier. 24 was the old, very soft look.
  const BG_DETAIL = 32;

  // Comments longer than this get cut off with "Show more".
  const LONG_CHARS = 650;
  const LONG_LINES = 9;

  /* ---------- shared bits ---------- */

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const crumb = $('crumb');
  const stage = $('stage');
  const sceneWrap = $('sceneWrap');
  const musicWrap = $('musicWrap');
  const stageMsg = $('stageMsg');
  const sceneBar = $('sceneBar');
  const prevBtn = $('prevBtn');
  const nextBtn = $('nextBtn');
  const dock = $('dock');
  const dockTitle = $('dockTitle');
  const dockPlay = $('dockPlay');
  const cloudsEl = $('clouds');
  const upnext = $('upnext');
  const topBar = $('top');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isPhone = () => window.innerWidth < 640;

  let DATA = null;
  const setting = (k) => {
    const v = DATA && DATA.settings ? Number(DATA.settings[k]) : NaN;
    return Number.isFinite(v) ? v : DEFAULTS[k];
  };
  // Small wrapper so a blocked localStorage never breaks the page.
  const saved = {
    get(k) { try { return localStorage.getItem('echolog.' + k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem('echolog.' + k, String(v)); } catch (_) { /* ignore */ } },
  };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const ICON = {
    play: 'M8 5l11 7-11 7z',
    pause: 'M9 5v14M15 5v14',
    sound: 'M4 9v6h4l5 4V5L8 9H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
    muted: 'M4 9v6h4l5 4V5L8 9H4zM17 9l5 6M22 9l-5 6',
    next: 'M6 5l9 7-9 7zM18 5v14',
    repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
    down: 'M12 5v14M6 13l6 6 6-6',
    left: 'M15 5l-7 7 7 7',
    right: 'M9 5l7 7-7 7',
  };
  function svg(name, size = 18) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICON[name]);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.8');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    s.append(p);
    return s;
  }
  // Only redraws an icon button when its icon actually changes.
  function setIcon(btn, name, label) {
    if (!btn || btn.dataset.icon === name) return;
    btn.dataset.icon = name;
    btn.replaceChildren(svg(name));
    btn.setAttribute('aria-label', label);
  }
  function iconBtn(cls, name, label) {
    const b = h('button', { class: cls, type: 'button' });
    setIcon(b, name, label);
    return b;
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const plural = (n, one, many) => `${(n || 0).toLocaleString('en')} ${n === 1 ? one : many}`;
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; };
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  };
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const scrollBehavior = reduced ? 'auto' : 'smooth';

  /* ---------- backdrop: blurred cover ----------
     The cover is drawn once into a 24 x 24 canvas and stretched to fill the screen.
     Stretching a tiny image gives the blur for free, and nothing is redrawn after that. */

  const coverCache = new Map();
  function loadCover(game) {
    if (coverCache.has(game.id)) return coverCache.get(game.id);
    const tries = game.cover ? [game.cover] : COVER_EXTS.map((e) => `${COVER_DIR}${encodeURIComponent(game.id)}.${e}`);
    const p = (async () => {
      for (const src of tries) {
        const img = await new Promise((res) => {
          const i = new Image();
          i.decoding = 'async';
          i.onload = () => res(i);
          i.onerror = () => res(null);
          i.src = src;
        });
        if (img) return img;
      }
      return null;
    })();
    coverCache.set(game.id, p);
    return p;
  }

  const layers = [...document.querySelectorAll('.bd-layer')];
  let activeLayer = 0;
  let coverKey = null;
  async function setCover(game) {
    const key = game ? game.id : '';
    if (key === coverKey) return;
    coverKey = key;
    const img = game ? await loadCover(game) : null;
    if (key !== coverKey) return; // a newer request won
    const next = layers[1 - activeLayer];
    if (img) {
      if (next.width !== BG_DETAIL) { next.width = BG_DETAIL; next.height = BG_DETAIL; }
      const ctx = next.getContext('2d');
      const n = next.width;
      ctx.clearRect(0, 0, n, n);
      if ('filter' in ctx) ctx.filter = 'blur(0.6px) saturate(1.3) brightness(0.62)';
      // Draw a little past the edges so the blur doesn't leave dark borders.
      ctx.drawImage(img, -2, -2, n + 4, n + 4);
      if (!('filter' in ctx)) { ctx.fillStyle = 'rgba(5,7,11,0.4)'; ctx.fillRect(0, 0, n, n); }
      next.classList.add('on');
    } else {
      next.classList.remove('on');
    }
    layers[activeLayer].classList.remove('on');
    activeLayer = 1 - activeLayer;
  }

  /* ---------- routing ---------- */

  const firstHash = location.hash;

  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
    const dec = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } };
    const n = parseInt(parts[2], 10);
    return {
      gameId: parts[0] ? dec(parts[0]) : null,
      songId: parts[1] ? dec(parts[1]) : null,
      scene: Number.isFinite(n) && n > 0 ? n - 1 : 0,
    };
  }

  function route() {
    const { gameId, songId, scene } = parseHash();
    const game = gameId ? DATA.games.find((g) => g.id === gameId) : null;
    const song = game && songId ? (game.songs || []).find((s) => s.id === songId) : null;

    // Same song, different scene: just swap the video. Comments, scroll and clouds stay.
    if (song && songState && songState.song === song && songState.plan) {
      switchScene(scene);
      return;
    }

    hideUpNext();
    leaveSong(!!song);
    app.replaceChildren();
    window.scrollTo(0, 0);

    if (song) renderSong(game, song, scene);
    else if (game && !songId) renderGame(game);
    else {
      if (gameId) history.replaceState(null, '', '#/');
      renderHome();
    }
    app.focus({ preventScroll: true });
    onPageScroll();
  }

  /* ---------- home ---------- */

  function renderHome() {
    document.title = 'Echolog';
    setSounds(null);
    document.body.classList.remove('on-song');
    crumb.replaceChildren();
    const games = [...DATA.games].sort((a, b) => String(a.title).localeCompare(String(b.title)));
    setCover(games[0] || null);

    const list = h('ul', { class: 'games' },
      games.map((g, i) => h('li', { class: 'rise has-menu', style: `--i:${i + 1}`, onmouseenter: () => setCover(g) },
        h('a', {
          href: `#/${encodeURIComponent(g.id)}`,
          onfocus: () => setCover(g),
        }, g.title),
        songMenu(g, null))));

    app.append(h('section', { class: 'view home' },
      h('div', { class: 'rise', style: '--i:0' }, h('span', { class: 'placeholder' }, '[TAGLINE]')),
      games.length ? list : h('p', { class: 'empty' }, 'No games yet.')));
  }

  /* ---------- game ---------- */

  function renderGame(game) {
    document.title = `${game.title} · Echolog`;
    setSounds(game);
    document.body.classList.remove('on-song');
    crumb.replaceChildren();
    setCover(game);

    const songsData = game.songs || [];
    const total = songsData.reduce((n, s) => n + (s.stories || []).length, 0);
    const songs = h('ol', { class: 'songs' },
      songsData.map((s, i) => h('li', { class: 'rise', style: `--i:${Math.min(i + 2, 12)}` },
        h('a', { href: songHref(game, s) },
          h('span', { class: 'n' }, pad2(i + 1)),
          h('span', { class: 't' }, s.title),
          h('span', { class: 'cnt' }, plural((s.stories || []).length, 'comment', 'comments'))))));

    const view = h('section', { class: 'view game' },
      h('h1', { class: 'game-title rise', style: '--i:0' }, game.title),
      h('p', { class: 'game-meta rise', style: '--i:1' },
        [game.year, plural(songsData.length, 'song', 'songs'), plural(total, 'comment', 'comments')].filter(Boolean).join(' · ')),
      songsData.length ? songs : h('p', { class: 'empty' }, 'No songs yet.'));

    // Steam reviews are game-wide. Only shown if the collector has any.
    if (game.stories && game.stories.length) {
      view.append(h('h2', { class: 'section-label' }, 'Steam reviews'), commentList(game.stories));
    }
    app.append(view);
  }

  // The game's songs as a small list. Shows when you hover (or tab to) a game's name.
  function songMenu(game, current) {
    const songs = game.songs || [];
    if (!songs.length) return null;
    return h('ul', { class: 'menu' }, songs.map((s, i) => h('li', null,
      h('a', { href: songHref(game, s), 'aria-current': s === current ? 'page' : null },
        h('span', { class: 'menu-n' }, pad2(i + 1)), s.title))));
  }

  const songHref = (game, s) => `#/${encodeURIComponent(game.id)}/${encodeURIComponent(s.id)}`;

  /* ---------- comments ---------- */

  // Decided from the text itself, so nothing has to be measured on screen.
  const isLong = (t) => t.length > LONG_CHARS || t.split('\n').length > LONG_LINES;

  function linkOrText(cls, href, text, tab) {
    return href
      ? h('a', { class: cls, href, target: '_blank', rel: 'noopener', tabindex: tab }, text)
      : h('span', { class: cls }, text);
  }

  function metaEl(c, inCloud) {
    const tab = inCloud ? '-1' : null;
    return h('div', { class: 'c-meta' },
      linkOrText('c-author', c.authorUrl, c.author || 'Unknown', tab),
      inCloud ? null : h('span', null, plural(c.likes || 0, 'like', 'likes')),
      inCloud ? null : h('span', null, fmtDate(c.date)),
      c.hoursPlayed != null ? h('span', null, `${Number(c.hoursPlayed).toLocaleString('en')} hrs played`) : null,
      c.url ? h('a', { class: 'c-link', href: c.url, target: '_blank', rel: 'noopener', tabindex: tab },
        c.source === 'steam' ? 'View on Steam' : 'View on YouTube') : null);
  }

  function commentEl(c) {
    const text = String(c.text || '');
    const p = h('p', { class: 'c-text' }, text);
    let more = null;
    if (isLong(text)) {
      p.classList.add('clamped');
      p.id = `t-${Math.random().toString(36).slice(2, 9)}`;
      more = h('button', { class: 'c-more', type: 'button', 'aria-expanded': 'false', 'aria-controls': p.id }, 'Show more');
      more.addEventListener('click', () => {
        const open = p.classList.toggle('clamped') === false;
        more.textContent = open ? 'Show less' : 'Show more';
        more.setAttribute('aria-expanded', String(open));
      });
    }
    return h('article', { class: 'c' }, p, more, metaEl(c));
  }

  function commentList(stories) {
    const wrap = h('div', { class: 'list' });
    wrap.append(...stories.map(commentEl));
    return wrap;
  }

  function commentsSection(stories) {
    let mode = 'liked';
    const listHolder = h('div');
    const btnLiked = h('button', { type: 'button', 'aria-pressed': 'true' }, 'Most liked');
    const btnNew = h('button', { type: 'button', 'aria-pressed': 'false' }, 'Newest');
    const draw = () => {
      btnLiked.setAttribute('aria-pressed', String(mode === 'liked'));
      btnNew.setAttribute('aria-pressed', String(mode === 'new'));
      const sorted = [...stories].sort(mode === 'liked'
        ? (a, b) => (b.likes || 0) - (a.likes || 0)
        : (a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      listHolder.replaceChildren(stories.length ? commentList(sorted) : h('p', { class: 'empty' }, 'No comments yet.'));
    };
    btnLiked.addEventListener('click', () => { if (mode !== 'liked') { mode = 'liked'; draw(); } });
    btnNew.addEventListener('click', () => { if (mode !== 'new') { mode = 'new'; draw(); } });
    const section = h('section', { class: 'comments', id: 'comments', 'aria-label': 'Comments' },
      h('div', { class: 'sort' },
        h('span', null, plural(stories.length, 'comment', 'comments')),
        stories.length > 1 ? h('div', null, btnLiked, btnNew) : null),
      listHolder);
    draw();
    return section;
  }

  /* ---------- what to play for a song ----------
     moment = the scene that plays on screen.
     audio  = a separate music track (optional). When set, the scene plays muted and the music
              plays over it, so you hear the song without the characters talking.
     A song with only audio shows that video as the scene. */

  // For testing without editing the data, add these before the #:
  //   ?t=1:35         scene start
  //   ?audio=VIDEOID  music track to lay over the scene
  //   ?at=0:12        music start
  // They only apply to the song the page was opened on.
  function readTime(t) {
    if (!t) return null;
    const parts = t.split(':').map(Number);
    if (parts.some(isNaN)) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  function testParams() {
    const inHash = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '';
    const a = new URLSearchParams(location.search);
    const b = new URLSearchParams(inHash);
    const get = (k) => a.get(k) || b.get(k);
    return { t: readTime(get('t')), audio: get('audio'), at: readTime(get('at')) };
  }

  // A song's scenes: "moments" if it has them, otherwise the single "moment".
  function scenesOf(song) {
    const list = Array.isArray(song.moments) && song.moments.length ? song.moments : (song.moment ? [song.moment] : []);
    return list.filter((m) => m && m.videoId);
  }

  function playable(song, useTest, index = 0) {
    const scenes = scenesOf(song);
    const m = scenes[index] || scenes[0] || null;
    let scene = m ? Object.assign({}, m) : null;
    const ownAudio = m && m.audio && m.audio.videoId ? m.audio : null;
    const songAudio = song.audio && song.audio.videoId ? song.audio : null;
    let music = ownAudio || songAudio ? Object.assign({}, ownAudio || songAudio) : null;
    if (useTest) {
      const p = testParams();
      if (p.audio) music = { videoId: p.audio, start: 0, end: null };
      if (music && p.at != null) { music.start = p.at; music.end = null; }
      if (scene && p.t != null) { scene.start = p.t; scene.end = null; }
    }
    if (!scene && music) { scene = music; music = null; }
    return scene ? { scene, music, index: m ? Math.max(0, scenes.indexOf(m)) : 0 } : null;
  }

  // The next (step 1) or previous (step -1) song that has something to play. Wraps round.
  function nextSong(game, song, step = 1) {
    const list = game.songs || [];
    const i = list.indexOf(song);
    for (let k = 1; k < list.length; k++) {
      const s = list[(((i + k * step) % list.length) + list.length) % list.length];
      if (playable(s, false)) return s;
    }
    return null;
  }

  /* ---------- song page ---------- */

  let songState = null;

  function renderSong(game, song, sceneIndex = 0) {
    document.title = `${song.title} · ${game.title} · Echolog`;
    setSounds(game);
    document.body.classList.add('on-song');
    setCover(game);
    crumb.replaceChildren(h('span', { class: 'has-menu crumb-menu' },
      h('a', { href: `#/${encodeURIComponent(game.id)}` }, game.title), songMenu(game, song)));

    const stories = song.stories || [];
    const n = stories.length;
    const plan = playable(song, location.hash === firstHash, sceneIndex);
    const next = plan ? nextSong(game, song) : null;
    const prev = plan ? nextSong(game, song, -1) : null;
    const scenes = scenesOf(song);
    const view = h('section', { class: 'view song' });
    songState = { game, song, plan, next, prev, scenes, ui: {}, ended: false, stayed: false };

    if (plan) {
      const ui = songState.ui;
      ui.play = iconBtn('ctl', 'pause', 'Pause');
      ui.sound = iconBtn('ctl', 'sound', 'Mute');
      ui.vol = h('input', { class: 'vol', type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Volume' });
      // The volume slider pops up above the sound button when you hover or tab to it.
      const volWrap = h('span', { class: 'vol-wrap' }, ui.sound, h('span', { class: 'vol-pop' }, ui.vol));
      ui.repeat = iconBtn('ctl ctl-repeat', 'repeat', 'Repeat this song');
      ui.time = h('span', { class: 'ctl-time' }, '0:00');
      ui.seek = h('input', { class: 'seek', type: 'range', min: '0', max: '100', step: '1', value: '0', 'aria-label': 'Seek' });
      ui.play.addEventListener('click', togglePlay);
      ui.sound.addEventListener('click', toggleSound);
      ui.vol.value = String(currentVolume());
      ui.vol.style.setProperty('--p', `${currentVolume()}%`);
      ui.vol.addEventListener('input', () => setVolume(Number(ui.vol.value)));
      ui.repeat.setAttribute('aria-pressed', String(repeatOn()));
      ui.repeat.addEventListener('click', () => {
        const on = !repeatOn();
        saved.set('repeat', on ? '1' : '0');
        ui.repeat.setAttribute('aria-pressed', String(on));
        if (on) hideUpNext();
      });
      ui.seek.addEventListener('input', () => { ui.seeking = true; seekTo(Number(ui.seek.value)); });
      ui.seek.addEventListener('change', () => { ui.seeking = false; });
      const controls = h('div', { class: 'controls' }, ui.play, volWrap, ui.repeat, ui.time, ui.seek);

      // More than one scene: a bar of big buttons above the video, as wide as the video.
      if (scenes.length > 1) {
        ui.scenes = scenes.map((m, i) => h('a', {
          class: 'scene-btn',
          href: `${songHref(game, song)}/${i + 1}`,
          'aria-current': i === plan.index ? 'true' : null,
        }, m.label || `Scene ${i + 1}`));
        sceneBar.replaceChildren(...ui.scenes);
      } else {
        sceneBar.replaceChildren();
      }
      // Previous and next song: big buttons either side of the video.
      setSideBtn(prevBtn, prev, 'left', 'Previous song');
      setSideBtn(nextBtn, next, 'right', 'Next song');
      const text = [song.composer, scenes.length === 1 && scenes[0].label].filter(Boolean).join(' · ');
      const sub = text ? h('small', null, text) : null;
      view.append(
        h('div', { class: 'hero-space' }),
        h('div', { class: 'peek rise', style: '--i:2' },
          h('div', { class: 'peek-title' }, h('h1', null, song.title), sub),
          controls,
          h('button', {
            class: 'peek-more', type: 'button', 'aria-label': `${plural(n, 'comment', 'comments')}, scroll down`,
            onclick: () => $('comments').scrollIntoView({ behavior: scrollBehavior }),
          }, h('span', null, n.toLocaleString('en')), h('span', { class: 'pm-word' }, n === 1 ? 'comment' : 'comments'), svg('down', 16))),
        commentsSection(stories));
    } else {
      view.append(
        h('header', { class: 'song-head rise', style: '--i:0' },
          h('h1', null, song.title),
          h('p', null, [song.composer, 'No clip yet'].filter(Boolean).join(' · '))),
        commentsSection(stories));
    }
    app.append(view);
    if (plan) openStage(plan, song);
    else if (!stage.hidden) closeStage();
  }

  function setSideBtn(btn, song, icon, label) {
    const st = songState;
    if (!song || song === st.song) { btn.hidden = true; return; }
    btn.hidden = false;
    btn.href = songHref(st.game, song);
    btn.setAttribute('aria-label', `${label}: ${song.title}`);
    btn.title = song.title;
    btn.replaceChildren(svg(icon, 28));
  }

  // Swap to another scene of the song that's already open.
  // If the music track is the same, it keeps playing and only the picture changes.
  function switchScene(i) {
    const st = songState;
    const plan = playable(st.song, false, i);
    if (!plan) return;
    if (st.plan && plan.index === st.plan.index && plan.scene.videoId === st.plan.scene.videoId) return;
    const old = st.plan;
    st.plan = plan;
    if (st.ui.scenes) st.ui.scenes.forEach((b, k) => (k === plan.index ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
    stageMsg.hidden = true;
    const sameMusic = old && old.music && plan.music && sep() && media.ready.music
      && old.music.videoId === plan.music.videoId && (old.music.start || 0) === (plan.music.start || 0);
    if (sameMusic) {
      swapScene(plan);
      return;
    }
    st.ended = false;
    st.stayed = false;
    hideUpNext();
    stopClouds(true);
    loadMedia(plan);
  }

  // keepStage: going straight to another song, so the players stay and just load the new video.
  function leaveSong(keepStage) {
    const st = songState;
    if (!st) return;
    stopClouds(true);
    songState = null;
    if (!keepStage) closeStage();
    else { sceneBar.replaceChildren(); prevBtn.hidden = nextBtn.hidden = true; }
  }

  /* ---------- the video stage ----------
     The player stays at least 200 x 200 (YouTube's minimum), so the small player is 356 x 200.
     Moving between big and small sets the new size once, then animates with transform only. */

  let mini = false;
  let calm = false; // only used when CLOUDS_OVER_VIDEO is false

  function layout() {
    const W = document.documentElement.clientWidth;
    const H = window.innerHeight;
    const css = getComputedStyle(document.documentElement);
    const top = parseFloat(css.getPropertyValue('--top')) || 56;
    const peek = parseFloat(css.getPropertyValue('--peek')) || 92;
    // Room for the scene bar above the video, when the song has more than one scene.
    const bar = songState && songState.scenes && songState.scenes.length > 1 ? (isPhone() ? 44 : 56) : 0;
    const availH = Math.max(200, H - top - peek - bar);

    const bw = Math.max(200, Math.min(W, availH * 16 / 9));
    const bh = bw * 9 / 16;
    const upright = isPhone() && availH > bh * 1.6;
    const big = { left: (W - bw) / 2, top: bar + (upright ? top + 12 : top + (availH - bh) / 2), width: bw, height: bh };

    const margin = Math.min(360, Math.max(260, W * 0.2));
    const cw = Math.max(356, Math.min(bw, W - margin * 2));
    const ch = cw * 9 / 16;
    const calmR = { left: (W - cw) / 2, top: bar + top + (availH - ch) / 2, width: cw, height: ch };

    // Phones keep the big size and slide it off the top instead.
    const small = isPhone() ? big : { left: W - 356 - 20, top: H - 200 - 52 - 20, width: 356, height: 200 };
    return { big, calm: calmR, small, top, peek, bar, W, H };
  }

  function currentRect(L) {
    if (mini) return L.small;
    if (calm && !isPhone()) return L.calm;
    return L.big;
  }

  function placeStage(animate) {
    if (stage.hidden) return;
    const L = layout();
    const r = currentRect(L);
    const prev = animate && !reduced && !isPhone() ? stage.getBoundingClientRect() : null;
    stage.style.width = r.width + 'px';
    stage.style.height = r.height + 'px';
    stage.style.left = r.left + 'px';
    stage.style.top = r.top + 'px';
    if (prev && prev.width) {
      const dx = prev.left - r.left;
      const dy = prev.top - r.top;
      const sx = prev.width / r.width;
      const sy = prev.height / r.height;
      if (Math.abs(dx) + Math.abs(dy) > 1 || Math.abs(sx - 1) > 0.01) {
        stage.style.transition = 'none';
        stage.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        void stage.offsetWidth;
        stage.style.transition = '';
        stage.style.transform = '';
      }
    } else {
      stage.style.transform = '';
    }
    stage.classList.toggle('away', mini && isPhone());
    placeExtras(L, mini ? L.big : r);
    if (!isPhone()) {
      dock.style.left = L.small.left + 'px';
      dock.style.top = (L.small.top + L.small.height + 8) + 'px';
      dock.style.width = L.small.width + 'px';
    } else {
      dock.style.left = dock.style.top = dock.style.width = '';
    }
  }

  // The scene bar sits right above the video, and the previous/next buttons either side of it
  // (inside its edges when the screen has no room beside it). They fade out with the small player.
  function placeExtras(L, r) {
    const show = !mini && !stage.hidden;
    sceneBar.hidden = !L.bar || !sceneBar.childElementCount;
    if (!sceneBar.hidden) {
      Object.assign(sceneBar.style, { left: r.left + 'px', top: (r.top - L.bar) + 'px', width: r.width + 'px', height: L.bar + 'px' });
      sceneBar.classList.toggle('gone', !show);
    }
    const size = isPhone() ? 44 : 60;
    const gap = 16;
    const y = r.top + r.height / 2 - size / 2;
    const outside = r.left >= size + gap * 2;
    prevBtn.style.left = (outside ? r.left - size - gap : r.left + 10) + 'px';
    nextBtn.style.left = (outside ? r.left + r.width + gap : r.left + r.width - size - 10) + 'px';
    for (const b of [prevBtn, nextBtn]) {
      b.style.top = y + 'px';
      b.classList.toggle('gone', !show);
      b.classList.toggle('inside', !outside);
    }
  }

  function setMini(on) {
    if (!songState || !songState.plan || mini === on) return;
    mini = on;
    document.body.classList.toggle('mini', on);
    stage.classList.toggle('mini', on);
    dock.hidden = !on;
    requestAnimationFrame(() => dock.classList.toggle('show', on));
    if (on) { calm = false; stopClouds(); }
    placeStage(true);
    if (!on) startClouds();
  }

  function openStage(plan, song) {
    dockTitle.textContent = song.title;
    stageMsg.hidden = true;
    if (stage.hidden) {
      mini = false;
      calm = false;
      document.body.classList.remove('mini');
      stage.hidden = false;
      stage.classList.remove('mini', 'away');
      stage.classList.add('entering');
      placeStage(false);
      requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove('entering')));
    } else {
      // Next song: back to the big video.
      mini = true;
      setMini(false);
      dock.hidden = true;
      dock.classList.remove('show');
    }
    loadMedia(plan);
  }

  function closeStage() {
    destroyMedia();
    sceneBar.hidden = true;
    sceneBar.replaceChildren();
    prevBtn.hidden = nextBtn.hidden = true;
    stage.hidden = true;
    stage.classList.remove('mini', 'away');
    document.body.classList.remove('mini');
    mini = false;
    calm = false;
    dock.hidden = true;
    dock.classList.remove('show');
  }

  function showStageMsg(text) {
    stageMsg.textContent = text;
    stageMsg.hidden = false;
  }

  // Taps on the video go to us, not to YouTube, so the scene and the music always pause and play
  // together. Tap the big video: pause or play. Tap the small player: make it big again.
  // The bottom-right corner is left open so YouTube's "Skip ad" button can still be pressed.
  $('stageTap').addEventListener('click', () => {
    if (mini) window.scrollTo({ top: 0, behavior: scrollBehavior });
    else togglePlay();
  });

  /* ---------- YouTube players ---------- */

  const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 };
  let ytPromise = null;
  function loadYT() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (ytPromise) return ytPromise;
    ytPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => { ytPromise = null; reject(new Error('blocked')); };
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('timeout')), 12000);
    });
    return ytPromise;
  }

  // The players stay alive from song to song so the next one starts quickly.
  const media = {
    plan: null, scene: null, music: null, ready: { scene: false, music: false }, token: 0,
    userMuted: false, tick: null, playing: false,
    sceneExpect: null, // what we last told the scene to do
    gate: null,        // while both players are loading: { scene, music, timer } (see loadMedia)
  };

  const sep = () => !!(media.plan && media.plan.music && media.music);
  const master = () => (sep() && media.ready.music ? media.music : (!sep() && media.ready.scene ? media.scene : null));
  const masterSpec = () => (media.plan ? (sep() ? media.plan.music : media.plan.scene) : null);
  const safe = (fn) => { try { return fn(); } catch (_) { return undefined; } };
  const repeatOn = () => saved.get('repeat') === '1';
  const leadSeconds = () => Math.max(0, setting('upNextSeconds'));

  // Volume: a visitor's own choice for this song, else the song's volume from the admin page, else the site default.
  const clampVol = (v) => Math.max(0, Math.min(100, v));
  const volKey = () => (songState ? `volume:${songState.game.id}/${songState.song.id}` : null);
  function currentVolume() {
    const key = volKey();
    const mine = key ? saved.get(key) : null;
    if (mine != null && Number.isFinite(Number(mine))) return clampVol(Number(mine));
    const songVol = songState && songState.song ? Number(songState.song.volume) : NaN;
    if (songState && songState.song && songState.song.volume != null && Number.isFinite(songVol)) return clampVol(songVol);
    return clampVol(setting('volume'));
  }

  // Tell the scene to play or pause, and remember that it was us.
  function sceneDo(action) {
    if (!media.scene || !media.ready.scene) return;
    media.sceneExpect = { action, at: Date.now() };
    safe(() => (action === 'play' ? media.scene.playVideo() : media.scene.pauseVideo()));
  }

  async function loadMedia(plan) {
    const token = ++media.token;
    media.plan = plan;
    media.playing = false;
    if (songState) { songState.ended = false; songState.stayed = false; }
    let YT;
    try { YT = await loadYT(); } catch (_) {
      if (token === media.token) showStageMsg("Couldn't load the video player.");
      return;
    }
    if (token !== media.token) return;
    // With a separate music track, both players load at the same time, muted. Each one is held at
    // its start as soon as it can play, and once both are ready they start together. Without this
    // the scene started a second or two after the music while it buffered.
    clearGate();
    if (plan.music) {
      media.gate = { scene: false, music: false, timer: setTimeout(() => openGate(token), 6000) };
    }
    usePlayer(YT, 'scene', plan.scene, true);
    if (plan.music) usePlayer(YT, 'music', plan.music, true);
    else dropPlayer('music');
    applyAudio();
    clearInterval(media.tick);
    media.tick = setInterval(tick, 250);
    if (!media.gate) setTimeout(() => { if (token === media.token) checkAutoplay(); }, 1800);
  }

  function clearGate() {
    if (media.gate) clearTimeout(media.gate.timer);
    media.gate = null;
  }

  // While loading: a player that starts playing is paused and put back at its start until the other one is ready too.
  function gateState(role, s) {
    const g = media.gate;
    if (s !== YT_STATE.PLAYING || g[role]) return;
    g[role] = true;
    if (g.scene && g.music) { openGate(media.token); return; }
    const p = media[role];
    const spec = role === 'music' ? media.plan.music : media.plan.scene;
    if (role === 'scene') media.sceneExpect = { action: 'pause', at: Date.now() };
    safe(() => { p.pauseVideo(); p.seekTo(spec.start || 0, true); });
  }

  function openGate(token) {
    if (token !== media.token || !media.gate) return;
    const plan = media.plan;
    clearGate();
    safe(() => media.music.seekTo(plan.music.start || 0, true));
    if (media.scene && media.ready.scene) safe(() => media.scene.seekTo(plan.scene.start || 0, true));
    applyAudio();
    safe(() => media.music.playVideo());
    sceneDo('play');
    setTimeout(() => { if (token === media.token) checkAutoplay(); }, 1500);
  }

  // A different scene with the same music: only the picture changes.
  function swapScene(plan) {
    media.plan = plan;
    media.sceneExpect = { action: media.playing ? 'play' : 'pause', at: Date.now() };
    loadYT().then((YT) => {
      if (media.plan !== plan) return;
      usePlayer(YT, 'scene', plan.scene, true);
      applyAudio();
    }).catch(() => {});
  }

  function usePlayer(YT, role, spec, autoplay) {
    const p = media[role];
    const opts = { videoId: spec.videoId, startSeconds: spec.start || 0, endSeconds: spec.end || undefined };
    if (p && media.ready[role]) {
      safe(() => (autoplay ? p.loadVideoById(opts) : p.cueVideoById(opts)));
      return;
    }
    dropPlayer(role);
    const wrap = role === 'scene' ? sceneWrap : musicWrap;
    const id = role === 'scene' ? 'ytScene' : 'ytMusic';
    wrap.replaceChildren(h('div', { id }));
    media.ready[role] = false;
    media[role] = new YT.Player(id, {
      width: '100%',
      height: '100%',
      videoId: spec.videoId,
      playerVars: Object.assign({
        autoplay: autoplay ? 1 : 0,
        controls: 0,        // no YouTube control bar; ours sits under the video
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,  // no annotations
        playsinline: 1,
        rel: 0,
        start: Math.floor(spec.start || 0),
      }, spec.end ? { end: Math.floor(spec.end) } : {},
      // Start muted when the scene sits under a music track, or while waiting to start together.
      (role === 'scene' && media.plan && media.plan.music) || (role === 'music' && media.gate) ? { mute: 1 } : {}),
      events: {
        onReady: () => onReady(role),
        onStateChange: (e) => onState(role, e.data),
        onError: (e) => onError(role, e.data),
      },
    });
  }

  function dropPlayer(role) {
    const p = media[role];
    media[role] = null;
    media.ready[role] = false;
    if (p) safe(() => p.destroy());
    (role === 'scene' ? sceneWrap : musicWrap).replaceChildren();
  }

  function destroyMedia() {
    media.token++;
    clearGate();
    clearInterval(media.tick);
    media.tick = null;
    dropPlayer('scene');
    dropPlayer('music');
    media.plan = null;
    media.playing = false;
  }

  function onReady(role) {
    media.ready[role] = true;
    const p = media[role];
    const spec = media.plan && (role === 'music' ? media.plan.music : media.plan.scene);
    if (!spec) return;
    // Backup for the start setting. Only jumps if the player really ignored it, so the clip doesn't skip twice.
    const t = safe(() => p.getCurrentTime()) || 0;
    if (spec.start && t < spec.start - 1) safe(() => p.seekTo(spec.start, true));
    applyAudio();
    // Scene became ready after the music already started: catch up.
    if (!media.gate && role === 'scene' && sep() && media.playing) sceneDo('play');
    sync();
  }

  function onState(role, s) {
    const plan = media.plan;
    if (!plan) return;
    if (media.gate) { gateState(role, s); return; }
    const isMaster = role === (sep() ? 'music' : 'scene');
    if (isMaster) {
      media.playing = s === YT_STATE.PLAYING;
      if (sep()) {
        // The scene follows the music: starts with it, pauses with it, waits while it buffers.
        if (s === YT_STATE.PLAYING) sceneDo('play');
        if (s === YT_STATE.PAUSED || s === YT_STATE.BUFFERING) sceneDo('pause');
      }
      if (s === YT_STATE.PLAYING) {
        applyAudio();
        if (songState && songState.ended) { songState.ended = false; hideUpNext(); }
        startClouds();
      }
      if (s === YT_STATE.PAUSED) stopClouds();
      if (s === YT_STATE.ENDED) songEnded();
      sync();
      return;
    }
    if (role === 'scene' && sep()) {
      if (s === YT_STATE.ENDED) {
        // Music still going: loop the scene.
        media.sceneExpect = { action: 'play', at: Date.now() };
        safe(() => { media.scene.seekTo(plan.scene.start || 0, true); media.scene.playVideo(); });
        return;
      }
      // The scene only plays while the music does.
      const ms = safe(() => media.music.getPlayerState());
      if (s === YT_STATE.PLAYING && (ms === YT_STATE.PAUSED || ms === YT_STATE.ENDED)) sceneDo('pause');
    }
  }

  function onError(role) {
    const plan = media.plan;
    if (!plan) return;
    if (role === 'music') {
      // Music track gone: fall back to the scene's own sound.
      dropPlayer('music');
      plan.music = null;
      applyAudio();
      sceneDo('play');
      return;
    }
    if (sep()) {
      showStageMsg('Clip unavailable');
      return;
    }
    showStageMsg('This clip is unavailable.');
    songEnded();
  }

  // Sound goes through one player only. The scene is always muted when there's a separate music track.
  function applyAudio() {
    if (!media.plan) return;
    const vol = currentVolume();
    const audible = sep() ? media.music : media.scene;
    const audibleReady = sep() ? media.ready.music : media.ready.scene;
    if (sep() && media.scene && media.ready.scene) safe(() => media.scene.mute());
    if (media.gate) { if (media.music && media.ready.music) safe(() => media.music.mute()); return; }
    if (audible && audibleReady) {
      safe(() => {
        audible.setVolume(vol);
        if (media.userMuted || vol === 0) audible.mute(); else audible.unMute();
      });
    }
  }

  function setVolume(v) {
    v = clampVol(Math.round(v));
    const key = volKey();
    if (key) saved.set(key, v);
    if (v > 0) media.userMuted = false;
    if (songState && songState.ui.vol) {
      songState.ui.vol.value = String(v);
      songState.ui.vol.style.setProperty('--p', `${v}%`);
    }
    applyAudio();
    setTimeout(sync, 80);
  }

  // If the browser blocked sound, start muted so the clip still plays, and make the sound button glow.
  function checkAutoplay() {
    const p = master();
    if (!p || media.gate) return;
    const s = safe(() => p.getPlayerState());
    if (s === YT_STATE.PLAYING || s === YT_STATE.BUFFERING || s === YT_STATE.ENDED) return;
    safe(() => { p.mute(); p.playVideo(); });
    setTimeout(sync, 300);
  }

  function togglePlay() {
    const p = master();
    if (!p || media.gate) return;
    if (safe(() => p.getPlayerState()) === YT_STATE.PLAYING) safe(() => p.pauseVideo());
    else safe(() => p.playVideo());
  }

  function toggleSound() {
    const p = master();
    if (!p) return;
    const muted = safe(() => p.isMuted());
    media.userMuted = !muted;
    if (muted) {
      if (currentVolume() === 0) setVolume(60);
      safe(() => p.unMute());
    } else safe(() => p.mute());
    setTimeout(sync, 80);
  }

  function seekTo(sec) {
    const p = master();
    const spec = masterSpec();
    if (p && spec) safe(() => p.seekTo((spec.start || 0) + sec, true));
  }

  // Play the current scene again from the top (repeat).
  function restart() {
    if (!media.plan) return;
    if (songState) songState.ended = false;
    loadMedia(media.plan);
  }

  function tick() {
    if (document.hidden) return;
    const plan = media.plan;
    // A scene with its own end time loops while the music plays on.
    if (plan && sep() && plan.scene.end && media.scene && media.ready.scene) {
      const t = safe(() => media.scene.getCurrentTime()) || 0;
      if (t >= plan.scene.end) {
        media.sceneExpect = { action: 'play', at: Date.now() };
        safe(() => media.scene.seekTo(plan.scene.start || 0, true));
      }
    }
    sync();
  }

  function sync() {
    const st = songState;
    const p = master();
    if (!st || !p) return;
    const ui = st.ui;
    const playing = safe(() => p.getPlayerState()) === YT_STATE.PLAYING;
    const muted = !!safe(() => p.isMuted());
    setIcon(ui.play, playing ? 'pause' : 'play', playing ? 'Pause' : 'Play');
    setIcon(dockPlay, playing ? 'pause' : 'play', playing ? 'Pause' : 'Play');
    if (ui.sound) {
      setIcon(ui.sound, muted ? 'muted' : 'sound', muted ? 'Turn sound on' : 'Mute');
      ui.sound.classList.toggle('nudge', muted && !media.userMuted && currentVolume() > 0);
    }
    const spec = masterSpec();
    const start = spec.start || 0;
    const dur = safe(() => p.getDuration()) || 0;
    const end = spec.end || dur;
    const len = Math.max(0, end - start);
    const pos = Math.min(len, Math.max(0, (safe(() => p.getCurrentTime()) || 0) - start));
    if (ui.time) {
      const txt = len ? `${fmtTime(pos)} / ${fmtTime(len)}` : fmtTime(pos);
      if (ui.time.textContent !== txt) ui.time.textContent = txt;
    }
    if (ui.seek && len && !ui.seeking) {
      ui.seek.max = String(Math.floor(len));
      ui.seek.value = String(Math.floor(pos));
      ui.seek.style.setProperty('--p', `${(pos / len) * 100}%`);
      ui.seek.setAttribute('aria-valuetext', `${fmtTime(pos)} of ${fmtTime(len)}`);
    }
    if (len > 1) nearEnd(len - pos, playing);
  }

  dockPlay.addEventListener('click', togglePlay);
  $('dockUp').addEventListener('click', () => window.scrollTo({ top: 0, behavior: scrollBehavior }));

  /* ---------- up next ----------
     "Next: (song)" shows a few seconds before the song ends, and the next song starts the moment
     this one finishes. "Stay" cancels it for this play. Repeat plays the song again instead. */

  function nearEnd(left, playing) {
    const st = songState;
    const lead = leadSeconds();
    if (!st || !lead || repeatOn() || st.stayed || !st.next || st.next === st.song) return;
    if (playing && left <= lead) showUpNext(Math.ceil(left));
    else if (!upnext.hidden && left > lead + 1) hideUpNext(); // seeked back
  }

  function showUpNext(secs) {
    const st = songState;
    const txt = secs > 0 ? `Next: ${st.next.title} in ${secs}` : `Next: ${st.next.title}`;
    const el = $('upnextText');
    if (el.textContent !== txt) el.textContent = txt;
    if (upnext.hidden) {
      upnext.hidden = false;
      $('upnextGo').onclick = goNext;
      $('upnextStay').onclick = () => { if (songState) songState.stayed = true; hideUpNext(); };
    }
  }

  function goNext() {
    const st = songState;
    hideUpNext();
    if (st && st.next) location.hash = songHref(st.game, st.next);
  }

  let upTimer = null;
  function songEnded() {
    const st = songState;
    if (!st || st.ended) return;
    st.ended = true;
    if (repeatOn()) { restart(); return; }
    stopClouds();
    const next = st.next;
    if (!leadSeconds() || st.stayed || !next || next === st.song) {
      hideUpNext();
      if (!mini) $('comments').scrollIntoView({ behavior: scrollBehavior });
      return;
    }
    // Normal case: the banner is already up, so go straight on.
    if (!upnext.hidden) { goNext(); return; }
    // The clip ended early or failed: give a short countdown instead.
    let left = 5;
    showUpNext(left);
    clearInterval(upTimer);
    upTimer = setInterval(() => {
      left -= 1;
      if (songState !== st || st.stayed) return hideUpNext();
      if (left <= 0) goNext(); else showUpNext(left);
    }, 1000);
  }

  function hideUpNext() {
    clearInterval(upTimer);
    upTimer = null;
    upnext.hidden = true;
  }

  /* ---------- clouds ----------
     Short comments fade in over the big video one after another while the clip plays.
     They sit in the corners and sides, away from the middle where the action usually is,
     alternate left and right, stay up long enough to read, and drift a little while they're up. */

  const clouds = { timer: null, list: [], pool: [], recent: [], lastSide: null, started: false, song: null };

  function cloudPool(song) {
    const short = (song.stories || []).filter((c) => c.text && c.text.length <= CLOUD_MAX_CHARS);
    // Best 30 by score, in a random order.
    return shuffle([...short].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 30));
  }

  // Every comment shows once before any comes round again, and the last few shown
  // never come straight back when the list starts over.
  function refillClouds() {
    const fresh = cloudPool(songState.song);
    const keep = Math.min(5, Math.max(0, fresh.length - 1));
    const recentIds = keep ? clouds.recent.slice(-keep).reverse() : []; // most recent first
    const byId = new Map(fresh.map((c) => [c.id, c]));
    const recent = recentIds.map((id) => byId.get(id)).filter(Boolean);
    // pop() takes from the end: comments not seen lately come first, and the most recent one comes last.
    clouds.pool = [...recent, ...fresh.filter((c) => !recentIds.includes(c.id))];
  }

  const canCloud = () => !!(songState && songState.plan && !mini && media.playing && !document.hidden && !songState.ended);

  // Starts the cloud loop if it isn't already waiting. Leave out delay to use the normal one.
  function startClouds(delay) {
    if (!canCloud() || clouds.timer) return;
    if (clouds.song !== songState.song) {
      clouds.song = songState.song;
      clouds.recent = [];
      clouds.pool = [];
      refillClouds();
      clouds.started = false;
    }
    if (!clouds.pool.length && !cloudPool(songState.song).length) return;
    if (delay == null) delay = clouds.started ? 2500 : CLOUD_FIRST_MS;
    clouds.timer = setTimeout(cloudLoop, delay);
  }

  function cloudLoop() {
    clouds.timer = null;
    if (!canCloud()) return;
    if (!CLOUDS_OVER_VIDEO && !calm && !isPhone()) {
      // Make room beside the video first.
      calm = true;
      placeStage(true);
      clouds.timer = setTimeout(cloudLoop, 700);
      return;
    }
    const hold = spawnCloud();
    clouds.started = true;
    clouds.timer = setTimeout(cloudLoop, hold ? hold + CLOUD_GAP_MS - 2500 : 4000);
  }

  function stopClouds(now) {
    clearTimeout(clouds.timer);
    clouds.timer = null;
    for (const c of clouds.list) fadeCloud(c, now);
    clouds.list = [];
    if (now) cloudsEl.replaceChildren();
  }

  function fadeCloud(c, now) {
    clearTimeout(c.timer);
    if (now || reduced) { c.el.remove(); return; }
    c.el.classList.add('out');
    setTimeout(() => c.el.remove(), 1900);
  }

  // Places a cloud can go, as boxes on screen.
  function cloudSpots(r, L) {
    const spots = [];
    if (CLOUDS_OVER_VIDEO && !isPhone()) {
      const pad = Math.max(24, r.width * 0.04);
      const w = Math.min(340, r.width * 0.3);
      const y1 = r.top + pad;
      const y2 = r.top + r.height * 0.4;
      spots.push({ side: 'l', x: r.left + pad, y: y1, w, h: r.height * 0.3 });
      spots.push({ side: 'l', x: r.left + pad, y: y2, w, h: r.height * 0.32 });
      spots.push({ side: 'r', x: r.left + r.width - pad - w, y: y1, w, h: r.height * 0.3 });
      spots.push({ side: 'r', x: r.left + r.width - pad - w, y: y2, w, h: r.height * 0.32 });
      return spots;
    }
    const gap = 20;
    const minTop = L.top + 12;
    const maxBottom = L.H - L.peek - 8;
    if (r.left >= 240 + gap * 2) {
      spots.push({ side: 'l', x: gap, y: minTop, w: r.left - gap * 2, h: maxBottom - minTop });
      spots.push({ side: 'r', x: r.left + r.width + gap, y: minTop, w: L.W - r.left - r.width - gap * 2, h: maxBottom - minTop });
    }
    const belowY = r.top + r.height + gap;
    if (maxBottom - belowY >= 110) spots.push({ side: 'b', x: 12, y: belowY, w: L.W - 24, h: maxBottom - belowY });
    return spots;
  }

  // Returns how long the cloud stays up, or 0 if there was nowhere to put it.
  function spawnCloud() {
    const max = isPhone() ? 1 : CLOUD_MAX;
    while (clouds.list.length >= max) fadeCloud(clouds.list.shift());

    const L = layout();
    const r = currentRect(L);
    let spots = cloudSpots(r, L).filter((s) => !clouds.list.some((c) => c.spot === s));
    const otherSide = spots.filter((s) => s.side !== clouds.lastSide);
    if (otherSide.length) spots = otherSide;
    if (!spots.length) return 0;
    const spot = spots[Math.floor(Math.random() * spots.length)];

    if (!clouds.pool.length) refillClouds();
    const c = clouds.pool.pop();
    if (!c) return 0;
    clouds.recent.push(c.id);
    if (clouds.recent.length > 10) clouds.recent.shift();

    const el = h('div', { class: 'cloud' }, h('p', null, c.text), metaEl(c, true));
    el.style.maxWidth = Math.max(180, Math.min(340, spot.w)) + 'px';
    el.style.visibility = 'hidden';
    cloudsEl.append(el);
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    if (hgt > spot.h + 60) { el.remove(); return 0; }
    const x = spot.x + Math.random() * Math.max(0, spot.w - w);
    // Under the video on phones: stay close to it rather than drifting to the bottom of the screen.
    const room = Math.max(0, spot.h - hgt);
    const y = spot.y + Math.random() * (spot.side === 'b' ? Math.min(room, 60) : room);

    // Reading time: about 16 characters a second, plus time to notice it.
    const hold = Math.round(Math.min(14000, Math.max(6500, 3500 + c.text.length * 60)));
    const drift = 10 + Math.random() * 8;
    el.style.transform = `translate(${x}px, ${y + drift}px)`;
    el.style.visibility = '';
    void el.offsetWidth; // lock in the start position before the transition is set
    if (!reduced) el.style.transition = `opacity 1.4s ease, transform ${hold + 2000}ms linear`;
    void el.offsetWidth;
    el.classList.add('in');
    el.style.transform = `translate(${x}px, ${y - drift}px)`;

    const rec = { el, spot, timer: null };
    clouds.list.push(rec);
    clouds.lastSide = spot.side;
    rec.timer = setTimeout(() => {
      fadeCloud(rec);
      clouds.list = clouds.list.filter((x2) => x2 !== rec);
    }, hold);
    return hold;
  }

  /* ---------- page events ---------- */

  let scrollQueued = false;
  function onPageScroll() {
    scrollQueued = false;
    const y = window.scrollY;
    topBar.classList.toggle('solid', y > 12);
    if (songState && songState.plan) setMini(y > 24);
  }
  window.addEventListener('scroll', () => {
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(onPageScroll); }
  }, { passive: true });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      placeStage(false);
      // Clouds were placed for the old size.
      if (clouds.list.length) { stopClouds(true); startClouds(1500); }
    }, 120);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopClouds();
    else startClouds();
  });

  // Space or k plays and pauses, unless you're on a button, link or the seek bar.
  document.addEventListener('keydown', (e) => {
    if (!songState || !songState.plan || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|BUTTON|A|SELECT)$/.test(tag) || $('about').open) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(); }
  });

  /* ---------- sounds: short game sounds played over the music ---------- */

  const soundsBtn = $('soundsBtn');
  const soundsPanel = $('soundsPanel');
  const soundCache = new Map();
  let soundsGame = null;

  // Called on every page: the button only shows for a game that has sounds.
  function setSounds(game) {
    const list = game && Array.isArray(game.sounds) ? game.sounds.filter((x) => x && x.file) : [];
    closeSounds();
    if (!list.length) { soundsBtn.hidden = true; soundsGame = null; return; }
    soundsBtn.hidden = false;
    if (soundsGame === game) return;
    soundsGame = game;
    soundsPanel.replaceChildren(...list.map((snd) => h('button', {
      type: 'button', class: 'sound', onclick: () => playSound(snd.file),
    }, snd.label || 'Sound')));
  }

  function playSound(file) {
    let base = soundCache.get(file);
    if (!base) { base = new Audio(file); base.preload = 'auto'; soundCache.set(file, base); }
    // A copy each time, so pressing quickly plays them over each other.
    const a = base.cloneNode();
    a.volume = Math.max(0.05, currentVolume() / 100);
    a.play().catch(() => {});
  }

  function closeSounds() {
    soundsPanel.hidden = true;
    soundsBtn.setAttribute('aria-expanded', 'false');
  }
  soundsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = soundsPanel.hidden;
    soundsPanel.hidden = !open;
    soundsBtn.setAttribute('aria-expanded', String(open));
    // Load them now so the first press plays straight away.
    if (open && soundsGame) for (const snd of soundsGame.sounds || []) if (snd.file && !soundCache.has(snd.file)) {
      const a = new Audio(snd.file); a.preload = 'auto'; soundCache.set(snd.file, a);
    }
  });
  document.addEventListener('click', (e) => { if (!soundsPanel.hidden && !soundsPanel.contains(e.target)) closeSounds(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !soundsPanel.hidden) { closeSounds(); soundsBtn.focus(); } });

  const about = $('about');
  $('aboutBtn').addEventListener('click', () => {
    if (about.showModal) about.showModal(); else about.setAttribute('open', '');
  });

  /* ---------- start ---------- */

  async function start() {
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      DATA = await res.json();
      if (!DATA || !Array.isArray(DATA.games)) throw new Error('bad data');
    } catch (err) {
      app.replaceChildren(h('div', { class: 'notice' },
        h('p', null, `Couldn't load ${DATA_URL}. This page needs to run from a web server (GitHub Pages works), not straight from a file.`)));
      return;
    }
    window.addEventListener('hashchange', route);
    route();
  }

  start();
})();
