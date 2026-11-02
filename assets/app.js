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

  // Background: the cover is drawn once, BG_DETAIL pixels wide (shaped like the screen, cropped
  // to fill it), blurred by BG_BLUR pixels, then stretched to fill the screen. Bigger BG_DETAIL or
  // smaller BG_BLUR is sharper. (It used to be squashed into a 32 x 32 square, which looked blocky.)
  const BG_DETAIL = 160;
  // Width of the previous/next strips at the screen edges (desktop).
  const SIDE_W = 56;
  const BG_BLUR = 2.5;

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
  const dockSound = $('dockSound');
  const dockVol = $('dockVol');
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
    music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    film: 'M3 5h18v14H3zM7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4',
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

  // Blur, saturate and darken the small canvas by hand (three box blurs look like one soft blur).
  // Only used where the canvas has no blur of its own. It runs once per game on a tiny image.
  function handBlur(ctx, w, hgt, blur) {
    let data;
    try { data = ctx.getImageData(0, 0, w, hgt); } catch (e) {
      ctx.fillStyle = 'rgba(5,7,11,0.4)'; ctx.fillRect(0, 0, w, hgt); return;
    }
    const px = data.data;
    const r = Math.max(1, Math.round(blur * 0.8));
    const tmp = new Float32Array(px.length);
    const pass = (src, dst, len, count, step, lineStep) => {
      for (let line = 0; line < count; line++) {
        const base = line * lineStep;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let k = -r; k <= r; k++) sum += src[base + Math.min(len - 1, Math.max(0, k)) * step + c];
          for (let i = 0; i < len; i++) {
            dst[base + i * step + c] = sum / (r * 2 + 1);
            sum += src[base + Math.min(len - 1, i + r + 1) * step + c] - src[base + Math.max(0, i - r) * step + c];
          }
        }
      }
    };
    const buf = Float32Array.from(px);
    for (let n = 0; n < 3; n++) {
      pass(buf, tmp, w, hgt, 4, w * 4);   // across
      pass(tmp, buf, hgt, w, w * 4, 4);   // down
    }
    for (let i = 0; i < px.length; i += 4) {
      const R = buf[i], G = buf[i + 1], B = buf[i + 2];
      const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      px[i] = (lum + (R - lum) * 1.3) * 0.62;
      px[i + 1] = (lum + (G - lum) * 1.3) * 0.62;
      px[i + 2] = (lum + (B - lum) * 1.3) * 0.62;
      px[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
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
      const ctx = next.getContext('2d');
      // Safari (so every iPhone browser) has no canvas blur, so there the blur is done by hand
      // on the small canvas instead. It used to fall back to a 40-pixel canvas, which looked smeared.
      const canBlur = typeof ctx.filter === 'string';
      const w = BG_DETAIL;
      // Phones show only a narrow slice of the cover, so they get a lighter blur.
      const blur = window.innerWidth < 640 ? BG_BLUR * 0.6 : BG_BLUR;
      const hgt = Math.max(1, Math.round(w * window.innerHeight / Math.max(1, window.innerWidth)));
      next.width = w;
      next.height = hgt;
      ctx.clearRect(0, 0, w, hgt);
      if (canBlur) ctx.filter = `blur(${blur}px) saturate(1.3) brightness(0.62)`;
      // Crop the cover to fill the screen's shape, drawing a little past the edges so the blur doesn't leave dark borders.
      const pad = blur * 3;
      const scale = Math.max((w + pad * 2) / img.naturalWidth, (hgt + pad * 2) / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, (w - dw) / 2, (hgt - dh) / 2, dw, dh);
      if (!canBlur) handBlur(ctx, w, hgt, blur);
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

  // Song pages give the video the whole screen: the top bar folds into a small menu button.
  function setSongPage(on) {
    document.body.classList.toggle('on-song', on);
    document.documentElement.classList.toggle('song-page', on);
  }
  // Song pages: home, about (?) and a record that goes back to the game's songs.
  function setSongNav(game) {
    const link = $('navGame');
    link.href = `#/${encodeURIComponent(game.id)}`;
    link.title = `All ${game.title} songs`;
    link.setAttribute('aria-label', `All ${game.title} songs`);
    const label = $('vinylLabel');
    label.style.backgroundImage = '';
    loadCover(game).then((img) => { if (img && songState && songState.game === game) label.style.backgroundImage = `url("${img.src}")`; });
  }

  /* ---------- home ---------- */

  function renderHome() {
    document.title = 'Echolog';
    setSounds(null);
    setSongPage(false);
    crumb.replaceChildren();
    const games = [...DATA.games].sort((a, b) => String(a.title).localeCompare(String(b.title)));
    setCover(games[0] || null);

    // A search box over a plain list. It matches game names and song names.
    const items = games.map((g, i) => {
      const li = h('li', { class: 'rise', style: `--i:${Math.min(i + 1, 12)}`, onmouseenter: () => setCover(g) },
        h('a', { href: `#/${encodeURIComponent(g.id)}`, onfocus: () => setCover(g) }, g.title));
      const words = [g.title, ...(g.songs || []).map((s) => s.title)].join(' ').toLowerCase();
      return { g, li, words };
    });
    const list = h('ul', { class: 'games' }, items.map((x) => x.li));
    const none = h('p', { class: 'empty', hidden: true }, 'No games match.');
    const search = h('input', {
      class: 'search', type: 'search', placeholder: 'Search', 'aria-label': 'Search games and songs',
      autocomplete: 'off', spellcheck: 'false',
    });
    search.addEventListener('input', () => {
      // Stop the fade-in from replaying when a hidden game comes back.
      for (const x of items) x.li.classList.remove('rise');
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      for (const x of items) {
        const hit = !q || q.split(/\s+/).every((w) => x.words.includes(w));
        x.li.hidden = !hit;
        if (hit) shown++;
      }
      none.hidden = shown > 0;
      const first = items.find((x) => !x.li.hidden);
      if (q && first) setCover(first.g);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = items.find((x) => !x.li.hidden);
      if (first) location.hash = `#/${encodeURIComponent(first.g.id)}`;
    });

    app.append(h('section', { class: 'view home' },
      h('div', { class: 'search-wrap' }, search),
      games.length ? list : h('p', { class: 'empty' }, 'No games yet.'),
      none));
  }

  /* ---------- game ---------- */

  function renderGame(game) {
    document.title = `${game.title} · Echolog`;
    setSounds(null);
    setSongPage(false);
    crumb.replaceChildren();
    setCover(game);

    const songsData = game.songs || [];
    const songs = h('ol', { class: 'songs' },
      songsData.map((s, i) => {
        const len = songLength(s);
        return h('li', { class: 'rise', style: `--i:${Math.min(i + 2, 12)}` },
          h('a', { href: songHref(game, s) },
            h('span', { class: 'n' }, pad2(i + 1)),
            h('span', { class: 't' }, s.title),
            h('span', { class: 'cnt' }, len ? fmtTime(len) : '')));
      }));

    const view = h('section', { class: 'view game' },
      h('h1', { class: 'game-title rise', style: '--i:0' }, game.title),
      h('p', { class: 'game-meta rise', style: '--i:1' },
        [game.year, plural(songsData.length, 'song', 'songs')].filter(Boolean).join(' · ')),
      songsData.length ? songs : h('p', { class: 'empty' }, 'No songs yet.'));

    // Steam reviews are game-wide. Only shown if the collector has any.
    if (game.stories && game.stories.length) {
      view.append(h('h2', { class: 'section-label' }, 'Steam reviews'), commentList(game.stories));
    }
    app.append(view);
  }

  // How long a song plays, in seconds: what the collector worked out, or the end minus the start
  // of its music track (or first scene). Null if there's no end and no length from the collector.
  function songLength(song) {
    if (Number(song.length) > 0) return Number(song.length);
    const plan = playable(song, false);
    const spec = plan && (plan.music || plan.scene);
    return spec && spec.end ? Math.max(0, spec.end - (spec.start || 0)) : null;
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
    const art = h('article', { class: `c ${sizeClass(text)}` }, p, more, metaEl(c));
    const r = seeded(c.id || text);
    art.style.setProperty('--tilt', `${((r() * 2 - 1) * 1.3).toFixed(2)}deg`);
    art.style.setProperty('--shift', `${Math.round(r() * 12)}%`);
    // Where across the page it sits (0 = left edge, 1 = right edge).
    art.style.setProperty('--pos', r().toFixed(3));
    reveal(art);
    return art;
  }

  // Comments fade and rise into view as you scroll to them, one at a time.
  let revealer = null;
  function reveal(el) {
    if (reduced || !('IntersectionObserver' in window)) { el.classList.add('shown'); return; }
    if (!revealer) {
      revealer = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('shown');
          revealer.unobserve(e.target);
        }
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
    }
    el.classList.add('reveal');
    revealer.observe(el);
  }

  // Journal look: short comments are written bigger, long ones smaller.
  const sizeClass = (t) => (t.length < 110 ? 'c-short' : t.length < 320 ? 'c-mid' : 'c-long');
  // A small repeatable random number generator, so each comment always gets the same tilt and place.
  function seeded(str) {
    let x = 2166136261;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
    return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; };
  }

  function commentList(stories) {
    const wrap = h('div', { class: 'list' });
    wrap.append(...stories.map(commentEl));
    return wrap;
  }

  // One list, most liked first.
  function commentsSection(stories) {
    const sorted = [...stories].sort((a, b) => (b.likes || 0) - (a.likes || 0));
    // No heading and no count: the comments just sit under the video.
    return h('section', { class: 'comments', id: 'comments', 'aria-label': 'Comments' },
      stories.length ? commentList(sorted) : h('p', { class: 'empty' }, 'Nothing here yet.'));
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
    setSounds(Array.isArray(song.sounds) ? song.sounds : []);
    setSongPage(true);
    setCover(game);
    crumb.replaceChildren(h('span', { class: 'has-menu crumb-menu' },
      h('a', { href: `#/${encodeURIComponent(game.id)}` }, game.title), songMenu(game, song)));

    const plan = playable(song, location.hash === firstHash, sceneIndex);
    const stories = storiesFor(song, plan ? plan.index : 0);
    const n = stories.length;
    const next = plan ? nextSong(game, song) : null;
    const prev = plan ? nextSong(game, song, -1) : null;
    const scenes = scenesOf(song);
    const view = h('section', { class: 'view song' });
    songState = { game, song, plan, next, prev, scenes, stories, ui: {}, ended: false, stayed: false };
    setBarRows(plan ? (plan.music ? 2 : 1) : 0);
    setSongNav(game);

    if (plan) {
      const ui = songState.ui;
      ui.play = iconBtn('ctl', 'pause', 'Pause');
      ui.sound = iconBtn('ctl', 'sound', 'Mute');
      ui.vol = h('input', { class: 'vol', type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Volume' });
      // The volume slider pops up above the sound button when you hover or tab to it.
      const volWrap = h('span', { class: 'vol-wrap' }, ui.sound, h('span', { class: 'vol-pop' }, ui.vol));
      ui.repeat = iconBtn('ctl ctl-repeat', 'repeat', 'Repeat (all songs)');
      ui.repeat.title = 'Repeat. Stays on for every song until you turn it off.';
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
      ui.barsBox = h('div', { class: 'bars' });
      // More than one scene: a Scenes button next to the other controls, with a pop-up list.
      // The first time someone opens a song with several scenes, it shows how many there are,
      // until they open the list. After that it never shows on that song again.
      let scenesWrap = null;
      sceneBar.replaceChildren();
      if (scenes.length > 1) {
        const seenKey = `scenesSeen:${game.id}/${song.id}`;
        ui.sceneItems = scenes.map((m, i) => h('a', {
          class: 'scene-item',
          href: `${songHref(game, song)}/${i + 1}`,
          'aria-current': i === plan.index ? 'true' : null,
        }, h('span', { class: 'scene-n' }, String(i + 1)), m.label || `Scene ${i + 1}`));
        ui.sceneName = h('span', { class: 'scenes-name' }, scenes[plan.index].label || `Scene ${plan.index + 1}`);
        const badge = saved.get(seenKey) ? null : h('span', { class: 'scenes-badge', 'aria-label': `${scenes.length} scenes` }, String(scenes.length));
        ui.scenesBtn = h('button', { class: 'ctl scenes-btn', type: 'button', 'aria-expanded': 'false', 'aria-label': `Scenes (${scenes.length})` },
          svg('film'), ui.sceneName, badge);
        const pop = h('div', { class: 'scenes-pop', role: 'menu' },
          h('p', { class: 'scenes-head' }, 'Scenes'), ...ui.sceneItems);
        scenesWrap = h('span', { class: 'scenes-wrap' }, ui.scenesBtn, pop);
        const close = () => { scenesWrap.classList.remove('open'); ui.scenesBtn.setAttribute('aria-expanded', 'false'); };
        ui.scenesBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = !scenesWrap.classList.contains('open');
          scenesWrap.classList.toggle('open', open);
          ui.scenesBtn.setAttribute('aria-expanded', String(open));
          if (open) { saved.set(seenKey, '1'); const b = ui.scenesBtn.querySelector('.scenes-badge'); if (b) b.remove(); }
        });
        pop.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
      }
      const controls = h('div', { class: 'controls' }, ui.play, volWrap, ui.repeat, ui.barsBox);

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
          songState.ui.more = moreButton(n),
          // Scenes and Sounds sit together at the right end, both gold.
          scenesWrap, soundsBtn),
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

  // The comment count at the end of the strip; scrolls down to the comments.
  function moreButton(n) {
    return h('button', {
      class: 'peek-more', type: 'button', 'aria-label': 'Scroll down to the comments',
      onclick: () => $('comments').scrollIntoView({ behavior: scrollBehavior }),
    }, svg('down', 20));
  }

  // A scene with its own comments shows those; otherwise the song's.
  function storiesFor(song, index) {
    const m = scenesOf(song)[index];
    return m && Array.isArray(m.stories) ? m.stories : (song.stories || []);
  }

  // Put the comments for the scene now showing on the page (only if they're different).
  function showSceneComments(index) {
    const st = songState;
    const stories = storiesFor(st.song, index);
    if (stories === st.stories) return;
    st.stories = stories;
    const old = $('comments');
    if (old) old.replaceWith(commentsSection(stories));
    if (st.ui.more) { const b = moreButton(stories.length); st.ui.more.replaceWith(b); st.ui.more = b; }
    stopClouds(true);
    clouds.song = null;
    startClouds();
  }

  function setSideBtn(btn, song, icon, label) {
    const st = songState;
    if (!song || song === st.song) { btn.hidden = true; $(btn === prevBtn ? 'dockPrev' : 'dockNext').hidden = true; return; }
    btn.hidden = false;
    btn.href = songHref(st.game, song);
    btn.setAttribute('aria-label', `${label}: ${song.title}`);
    btn.removeAttribute('title');
    // Hover preview: a still from the song's scene, with its name and length.
    const plan = playable(song, false, 0);
    const vid = plan && (plan.scene || plan.music || {}).videoId;
    const len = songLength(song);
    const card = h('span', { class: 'side-card', 'aria-hidden': 'true' },
      vid ? h('img', { src: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`, alt: '', decoding: 'async' }) : null,
      h('span', { class: 'side-card-text' },
        h('small', null, label),
        h('strong', null, song.title),
        len ? h('small', null, fmtTime(len)) : null));
    btn.replaceChildren(svg(icon, 28), card);
    const d = $(btn === prevBtn ? 'dockPrev' : 'dockNext');
    d.href = btn.href;
    d.hidden = false;
    d.replaceChildren(svg(icon === 'left' ? 'left' : 'right'));
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
    if (st.ui.sceneItems) st.ui.sceneItems.forEach((b, k) => (k === plan.index ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
    if (st.ui.sceneName) st.ui.sceneName.textContent = st.scenes[plan.index].label || `Scene ${plan.index + 1}`;
    stageMsg.hidden = true;
    showSceneComments(plan.index);
    const sameMusic = old && old.music && plan.music && sep() && media.ready.music
      && old.music.videoId === plan.music.videoId && (old.music.start || 0) === (plan.music.start || 0);
    if (sameMusic) {
      swapScene(plan);
      return;
    }
    // Different music (or none): the new scene starts as far in as the song had got.
    const elapsed = songElapsed();
    st.ended = false;
    st.stayed = false;
    hideUpNext();
    stopClouds(true);
    loadMedia(plan, { elapsed });
  }

  // keepStage: going straight to another song, so the players stay and just load the new video.
  function leaveSong(keepStage) {
    const st = songState;
    if (!st) return;
    stopClouds(true);
    songState = null;
    setBarRows(0);
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
    const topVar = parseFloat(css.getPropertyValue('--top'));
    const top = Number.isFinite(topVar) ? topVar : 56; // 0 on song pages, so don't treat 0 as missing
    const peek = parseFloat(css.getPropertyValue('--peek')) || 92;
    // The scene picker lives in the controls now, so nothing sits above the video.
    const bar = 0;
    const availH = Math.max(200, H - top - peek - bar);
    // Desktop keeps the previous/next strips at the screen edges clear of the video.
    const sides = isPhone() ? 0 : SIDE_W * 2;

    const bw = Math.max(200, Math.min(W - sides, availH * 16 / 9));
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
  // Previous and next are strips flush with the screen edges, top to bottom (on phones, down to
  // the bottom of the video, so they don't cover the controls). They fade out with the small player.
  function placeExtras(L, r) {
    const show = !mini && !stage.hidden;
    sceneBar.hidden = true;
    const w = isPhone() ? 40 : SIDE_W;
    const height = isPhone() ? r.top + r.height : L.H;
    prevBtn.style.left = '0px';
    nextBtn.style.left = (L.W - w) + 'px';
    for (const b of [prevBtn, nextBtn]) {
      b.style.top = '0px';
      b.style.width = w + 'px';
      b.style.height = height + 'px';
      b.classList.toggle('gone', !show);
      b.classList.toggle('inside', isPhone());
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
    setLoading(false);
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

  // A short line at the bottom of the video that fades after a few seconds.
  let noteTimer = null;
  function stageNote(text) {
    let el = stage.querySelector('.stage-note');
    if (!el) { el = h('p', { class: 'stage-note', role: 'status' }); stage.append(el); }
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => el.classList.remove('on'), 7000);
  }

  function showStageMsg(text) {
    setLoading(false);
    stageMsg.textContent = text;
    stageMsg.hidden = false;
  }

  // Taps on the video go to us, not to YouTube, so the scene and the music always pause and play
  // together. Tap the big video: pause or play. Tap the small player: make it big again.
  // The bottom-right corner is left open so YouTube's "Skip ad" button can still be pressed.
  $('soundPill').addEventListener('click', (e) => { e.stopPropagation(); toggleSound(); });
  $('slPlay').addEventListener('click', (e) => { e.stopPropagation(); startByTap(); });
  $('stageTap').addEventListener('click', () => {
    if (mini) window.scrollTo({ top: 0, behavior: scrollBehavior });
    else togglePlay();
  });

  /* ---------- YouTube players ---------- */

  const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
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
    extra: 0,          // song seconds added by repeats, so the picture keeps going instead of jumping back
    repeatAt: 0,
    lock: false,       // picture locked to the music (set when both start together; off after a scene loops or swaps)
    loadTimer: null,
  };

  // How long to wait for the music before giving up and playing the scene with its own sound.
  const MUSIC_WAIT_MS = 15000;

  /* ---------- loading ----------
     While a song loads, the video area shows "Loading..." and the video, controls, scene bar and
     side buttons stay hidden. When it starts playing, they fade in together.
     Swapping scenes only covers the video. Gives up after 12 seconds so people can press play. */
  // What the loading screen shows: a still from the scene and the song's name.
  function fillLoading(plan, title) {
    const img = $('slStill');
    const vid = plan && (plan.scene || plan.music || {}).videoId;
    const src = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '';
    if (img.dataset.src !== src) {
      img.dataset.src = src;
      img.classList.remove('ok');
      img.onload = () => { if (img.naturalWidth > 120) img.classList.add('ok'); }; // YouTube's "no picture" image is 120 wide
      img.onerror = () => img.classList.remove('ok');
      if (src) img.src = src; else img.removeAttribute('src');
    }
    if (title != null) $('slTitle').textContent = title;
  }

  // The loading screen stays up until the video is actually playing, then everything fades in.
  // If nothing has started after a while (phones often won't start a video on their own),
  // the loading screen shows our own Play button, so YouTube's own button never shows.
  function setLoading(on, videoOnly) {
    clearTimeout(media.loadTimer);
    stage.classList.toggle('loading', on);
    stage.classList.remove('stuck');
    document.body.classList.toggle('media-loading', on && !videoOnly);
    if (on) media.loadTimer = setTimeout(showStart, touchScreen() ? 5000 : 12000);
  }

  // Only once the players have loaded, so pressing it can actually start them.
  function showStart() {
    if (!stage.classList.contains('loading')) return;
    const ready = media.ready.scene && (!media.plan || !media.plan.music || media.ready.music);
    if (!ready) { media.loadTimer = setTimeout(showStart, 1000); return; }
    // Phones: only when even the scene won't start by itself (music trouble is handled by musicWatch).
    // Then the scene player itself is shown to tap, since that's usually ads waiting for a tap.
    if (touchScreen()) {
      if (safe(() => media.scene.getPlayerState()) === YT_STATE.PLAYING || (media.gate && media.gate.scene)) return;
      showSceneForTap(true);
      return;
    }
    stage.classList.add('stuck');
  }

  // Our Play button on the loading screen.
  function startByTap() {
    stage.classList.remove('stuck');
    media.tapTried = true;
    media.stuckAt = 0;
    if (touchScreen() && sep() && !media.musicStarted) { sceneAlone(); wakeMusic(); return; }
    if (media.gate) { clearGate(); media.lock = sep(); }
    applyAudio();
    if (sep() && media.music) safe(() => media.music.playVideo());
    sceneDo('play');
    setTimeout(checkAutoplay, 1500);
    clearTimeout(media.loadTimer);
    media.loadTimer = setTimeout(showStart, 6000);
  }

  // Turn captions off. YouTube has no official switch for this, so this is best effort.
  function noCaptions(p) {
    safe(() => p.unloadModule('captions'));
    safe(() => p.unloadModule('cc'));
  }

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

  // Fades: the song's fadeIn / fadeOut (seconds, from the admin page) ramp the volume up at the start
  // and down at the end. Only the player's volume moves; the slider keeps showing the visitor's level.
  function fadeFactor() {
    const song = songState && songState.song;
    const fi = song ? Number(song.fadeIn) || 0 : 0;
    const fo = song ? Number(song.fadeOut) || 0 : 0;
    if (!fi && !fo) return 1;
    const p = master();
    const spec = masterSpec();
    if (!p || !spec) return 1;
    const { pos, len } = clipPos(p, spec);
    let f = 1;
    if (fi > 0) f = Math.min(f, pos / fi);
    if (fo > 0 && len > 0) f = Math.min(f, (len - pos) / fo);
    return Math.max(0, Math.min(1, f));
  }
  const fadedVolume = () => Math.round(currentVolume() * fadeFactor());

  function fadeTick() {
    if (document.hidden || !media.plan || media.gate || !songState) return;
    const song = songState.song;
    if (!(Number(song.fadeIn) > 0 || Number(song.fadeOut) > 0)) return;
    const p = master();
    if (!p || safe(() => p.getPlayerState()) !== YT_STATE.PLAYING) return;
    const v = fadedVolume();
    if (v !== media.fadeVol) { media.fadeVol = v; safe(() => p.setVolume(v)); }
  }
  setInterval(fadeTick, 100);

  // Tell the scene to play or pause, and remember that it was us.
  function sceneDo(action) {
    if (!media.scene || !media.ready.scene) return;
    media.sceneExpect = { action, at: Date.now() };
    safe(() => (action === 'play' ? media.scene.playVideo() : media.scene.pauseVideo()));
  }

  // Seconds into the song right now (from the start of the music track, or of the clip if there's no track).
  function songElapsed() {
    const p = master();
    const spec = masterSpec();
    if (!p || !spec) return 0;
    return Math.max(0, (safe(() => p.getCurrentTime()) || 0) - (spec.start || 0));
  }

  // Where a scene should be for a point in the song. Wraps round when the scene is shorter than the song.
  function sceneAt(scene, elapsed, duration) {
    const start = scene.start || 0;
    const end = scene.end || duration || 0;
    const len = end - start;
    return start + (len > 2 ? elapsed % len : elapsed);
  }

  // A point in a clip, or its start if that point is past (or right at) its end.
  function clipAt(spec, elapsed) {
    const start = spec.start || 0;
    if (spec.end && elapsed > spec.end - start - 3) return start;
    return start + elapsed;
  }

  /* Every song loads the same way: the players load muted and hidden behind "Loading...".
     Each one is held at its starting point as soon as it can play. Once all of them are ready,
     the video appears (still paused), and a moment later everything plays together.
     opts.elapsed: start this far into the song (used when switching scenes).
     opts.quiet: no "Loading..." (repeat). */
  async function loadMedia(plan, opts = {}) {
    const token = ++media.token;
    media.plan = plan;
    media.playing = false;
    media.lock = false;
    media.musicStarted = false;
    media.stuckAt = 0;
    media.tapTried = false;
    media.musicWait = false;
    media.musicTapShown = false;
    stage.classList.remove('music-tap', 'scene-tap');
    media.sceneAd = false;
    clearTimeout(media.wakeTimer);
    if (!opts.keepExtra) media.extra = 0;
    stageMsg.hidden = true;
    if (!opts.quiet) { fillLoading(plan, songState ? songState.song.title : ''); setLoading(true); }
    refreshBars();
    const elapsed = opts.elapsed || 0;
    if (plan.music) {
      const musicAt = clipAt(plan.music, elapsed);
      media.at = { music: musicAt, scene: sceneAt(plan.scene, musicAt - (plan.music.start || 0) + media.extra) };
    } else {
      media.at = { music: 0, scene: clipAt(plan.scene, elapsed) };
    }
    if (songState) { songState.ended = false; songState.stayed = false; }
    let YT;
    try { YT = await loadYT(); } catch (_) {
      if (token === media.token) showStageMsg("Couldn't load the video player.");
      return;
    }
    if (token !== media.token) return;
    clearGate();
    media.gate = { scene: false, music: !plan.music, timer: setTimeout(() => gateTimeout(token), MUSIC_WAIT_MS) };
    usePlayer(YT, 'scene', plan.scene, true, media.at.scene);
    if (plan.music) usePlayer(YT, 'music', plan.music, true, media.at.music);
    else dropPlayer('music');
    applyAudio();
    clearInterval(media.tick);
    media.tick = setInterval(tick, 250);
  }

  function clearGate() {
    if (media.gate) clearTimeout(media.gate.timer);
    media.gate = null;
  }

  // While loading: a player that starts playing is paused and held at its starting point until the others are ready too.
  function gateState(role, s) {
    const g = media.gate;
    if (s !== YT_STATE.PLAYING || g[role]) return;
    g[role] = true;
    const p = media[role];
    // Phones: never pause or move the music player while loading. "Playing" there may be ads, and
    // stopping ads part way leaves the player stuck (seen on Mohad's iPhone: an ad stopped at 3.8s).
    if (role === 'music' && touchScreen()) { if (g.scene && g.music) openGate(media.token); return; }
    if (role === 'scene') media.sceneExpect = { action: 'pause', at: Date.now() };
    safe(() => { p.pauseVideo(); p.seekTo(media.at[role], true); });
    if (g.scene && g.music) openGate(media.token);
  }

  // Waited too long. Music not there: play the scene with its own sound. Otherwise go with what's ready.
  // If the music player has loaded but just hasn't started (often an ad playing on it, on a phone
  // that isn't signed in to YouTube Premium), keep it: the picture waits for the music and joins it.
  // Only a music player that never loaded at all is dropped.
  function gateTimeout(token) {
    if (token !== media.token || !media.gate) return;
    if (!media.gate.music && media.plan.music && !media.ready.music) {
      dropPlayer('music');
      media.plan.music = null;
      refreshBars();
      stageNote("The music didn't load, so this is the scene's own sound.");
    }
    openGate(token);
  }

  // Everything's ready: show the video, then play.
  // Everything's ready: play, still under the loading screen. The screen fades away once it's
  // really playing (see onState). If it hasn't started in a few seconds, show our Play button.
  function openGate(token) {
    if (token !== media.token || !media.gate) return;
    clearGate();
    if (media.music && media.ready.music && !touchScreen()) safe(() => media.music.seekTo(media.at.music, true));
    if (media.scene && media.ready.scene) safe(() => media.scene.seekTo(media.at.scene, true));
    media.lock = sep();
    applyAudio();
    if (sep()) safe(() => media.music.playVideo());
    sceneDo('play');
    setTimeout(() => { if (token === media.token) checkAutoplay(); }, 1500);
    clearTimeout(media.loadTimer);
    media.loadTimer = setTimeout(() => { if (token === media.token) showStart(); }, touchScreen() ? 4000 : 6000);
  }

  // A different scene with the same music: only the picture changes, and it opens where the song is up to.
  function swapScene(plan) {
    media.plan = plan;
    media.lock = true;
    fillLoading(plan);
    setLoading(true, true);
    const mt = safe(() => media.music.getCurrentTime()) || 0;
    const at = sceneAt(plan.scene, mt - (plan.music.start || 0) + media.extra);
    media.sceneExpect = { action: media.playing ? 'play' : 'pause', at: Date.now() };
    loadYT().then((YT) => {
      if (media.plan !== plan) return;
      usePlayer(YT, 'scene', plan.scene, true, at);
      applyAudio();
    }).catch(() => {});
  }

  function usePlayer(YT, role, spec, autoplay, at) {
    const p = media[role];
    const from = at != null ? at : (spec.start || 0);
    const opts = { videoId: spec.videoId, startSeconds: from, endSeconds: spec.end || undefined };
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
        start: Math.floor(from),
        cc_load_policy: 0,
      }, spec.end ? { end: Math.ceil(spec.end) } : {},
      // Start muted while loading (and the scene always, when it sits under a music track).
      (role === 'scene' && media.plan && media.plan.music) || media.gate ? { mute: 1 } : {}),
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
    const want = media.at && media.gate ? media.at[role] : spec.start;
    if (want && t < want - 1) safe(() => p.seekTo(want, true));
    noCaptions(p);
    applyAudio();
    // Scene became ready after the music already started: catch up.
    if (!media.gate && role === 'scene' && sep() && media.playing) sceneDo('play');
    sync();
  }

  function onState(role, s) {
    const plan = media.plan;
    if (!plan) return;
    if (role === 'music' && s === YT_STATE.PLAYING) {
      media.musicStarted = true;
      showMusicForTap(false);
      if (media.musicWait) { media.musicWait = false; clearTimeout(media.wakeTimer); media.lock = true; applyAudio(); }
    }
    if (s === YT_STATE.PLAYING) noCaptions(media[role]);
    if (role === 'scene' && s === YT_STATE.PLAYING && stage.classList.contains('scene-tap')) showSceneForTap(false);
    if (media.gate) { gateState(role, s); return; }
    const isMaster = role === (sep() ? 'music' : 'scene');
    if (isMaster) {
      media.playing = s === YT_STATE.PLAYING;
      if (sep()) {
        // The scene follows the music: starts with it, pauses with it, waits while it buffers.
        if (s === YT_STATE.PLAYING && !media.musicAd) sceneDo('play');
        if ((s === YT_STATE.PAUSED || s === YT_STATE.BUFFERING) && !media.sceneAd) sceneDo('pause');
      }
      if (s === YT_STATE.PLAYING) {
        // Fade everything in once it's actually playing (the scene too, when there's a music track).
        if (!sep() || safe(() => media.scene.getPlayerState()) === YT_STATE.PLAYING) setLoading(false);
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
        // Music still going: loop the scene (to where it should be for the song, when locked).
        const mt = safe(() => media.music.getCurrentTime()) || 0;
        const dur = safe(() => media.scene.getDuration()) || 0;
        const to = media.lock ? sceneAt(plan.scene, mt - (plan.music.start || 0) + media.extra, dur) : (plan.scene.start || 0);
        media.sceneExpect = { action: 'play', at: Date.now() };
        safe(() => { media.scene.seekTo(to, true); media.scene.playVideo(); });
        return;
      }
      // The scene only plays while the music is actually playing (not while it's loading or buffering).
      const ms = safe(() => media.music.getPlayerState());
      if (s === YT_STATE.PLAYING && media.musicWait) { setLoading(false); startClouds(); sync(); return; }
      if (s === YT_STATE.PLAYING && ms !== YT_STATE.PLAYING && !media.sceneAd) { sceneDo('pause'); return; }
      if (s === YT_STATE.PLAYING) setLoading(false);
    }
  }

  // Give up on the music track and play the scene with its own sound, saying why.
  function dropMusic(note) {
    const plan = media.plan;
    if (!plan || !plan.music) return;
    const token = media.token;
    stageNote(note);
    clearGate();
    // Keep the music player (paused and muted) so the next song can try it again; phones are much
    // less willing to start a brand new player than one that has already played.
    if (media.music) safe(() => { media.music.pauseVideo(); media.music.mute(); });
    plan.music = null;
    media.lock = false;
    refreshBars();
    applyAudio();
    sceneDo('play');
    setTimeout(() => { if (token === media.token) checkAutoplay(); }, 1500);
  }

  // Phones: if the music won't start on its own (iPhones often refuse to start a second video),
  // show our Play button after a few seconds. If a tap doesn't start it either, use the scene's own sound.
  function musicWatch() {
    if (!touchScreen() || !sep() || media.musicStarted || media.musicWait || media.musicAd || !media.ready.scene) { media.stuckAt = 0; return; }
    if (media.gate && !media.gate.scene) { media.stuckAt = 0; return; }
    if (media.ready.music && safe(() => media.music.getPlayerState()) === YT_STATE.BUFFERING) { media.stuckAt = 0; return; }
    if (!media.stuckAt) { media.stuckAt = Date.now(); return; }
    if (Date.now() - media.stuckAt > 4000) { media.stuckAt = 0; sceneAlone(); }
  }

  /* Phones: the music won't start on its own (iPhones often won't start a second video without a tap).
     Play the scene by itself, muted, with "Tap for sound" showing. The tap starts the music from the
     point the scene has reached (see wakeMusic), and the scene locks to it. */
  function sceneAlone() {
    clearGate();
    media.musicWait = true;
    media.lock = false;
    // The music player is left alone (it may be playing ads, muted); see music-peek in tick.
    applyAudio();
    if (!media.musicAd) sceneDo('play');
    clearTimeout(media.loadTimer);
    media.loadTimer = setTimeout(showStart, 5000);
    sync();
  }

  // From a tap: start the music where the scene is up to. If it still won't play, use the scene's own sound.
  function wakeMusic() {
    const plan = media.plan;
    if (!plan || !plan.music) return;
    const token = media.token;
    media.tapTried = true;
    media.soundOk = true;
    media.userMuted = false;
    if (currentVolume() === 0) setVolume(60);
    if (media.music && media.ready.music) {
      const st = safe(() => media.scene.getCurrentTime()) || 0;
      let to = (plan.music.start || 0) + Math.max(0, st - (plan.scene.start || 0));
      const mEnd = plan.music.end || safe(() => media.music.getDuration()) || 0;
      if (mEnd && to > mEnd - 3) to = plan.music.start || 0;
      // Only move it if it's sitting paused on the song; if it hasn't started it may be on ads.
      const ms = safe(() => media.music.getPlayerState());
      if (ms === YT_STATE.PAUSED || ms === YT_STATE.CUED) safe(() => media.music.seekTo(to, true));
      safe(() => { media.music.setVolume(fadedVolume()); media.music.unMute(); media.music.playVideo(); });
    }
    if (!media.musicAd) sceneDo('play');
    clearTimeout(media.wakeTimer);
    media.wakeTimer = setTimeout(function giveUp() {
      if (token !== media.token || media.musicStarted || !media.musicWait) return;
      if (media.musicAd) { media.wakeTimer = setTimeout(giveUp, 2000); return; }
      // Still "not started" after our tap: on iPhones that's what an ad waiting for a tap looks like
      // (a tap on our button doesn't count as a tap on YouTube's player). Show the music player
      // itself so it can be tapped. Only if that doesn't work after a while, use the scene's sound.
      // It stays up until the music plays (no give-up timer: on iPhones an ad also reports
      // "not started", so the page can't tell an ad from a player waiting for a tap).
      if (media.music && media.ready.music && !media.musicTapShown) {
        showMusicForTap(true);
        return;
      }
      showMusicForTap(false);
      media.musicWait = false;
      // Unmuting the scene now (not from a tap) would make the phone pause it, so it stays muted
      // and "Tap for sound" comes back; that tap turns on the scene's own sound.
      media.soundOk = false;
      dropMusic("The music didn't start on this phone, so this is the scene's own sound.");
    }, 4000);
  }
  // The label over the video while ads are on (or may be waiting for a tap).
  function adLabel(text) { const el = $('adLabel'); if (el.textContent !== text) el.textContent = text; }
  const ADS_TEXT = 'Ads playing. The song starts after them.';

  // The hidden music player brought up over the scene, so a tap goes straight to YouTube's player.
  function showMusicForTap(on) {
    if (on) media.musicTapShown = true;
    stage.classList.toggle('music-tap', on);
    adLabel(on ? 'Tap the video to start the music. Ads may play first.' : ADS_TEXT);
    if (on) sceneDo('pause');
  }

  // Phones: the scene won't start by itself. Show its own player (loading screen and our tap layer
  // out of the way) so it can be tapped; ads often play first.
  function showSceneForTap(on) {
    stage.classList.toggle('scene-tap', on);
    adLabel(on ? 'Tap the video to start it. Ads may play first.' : ADS_TEXT);
  }
  const touchScreen = () => window.matchMedia('(pointer: coarse)').matches;
  // A tap inside YouTube's player moves focus into its frame. Once the music player has been
  // tapped, whatever plays before the song is an ad, so say so.
  window.addEventListener('blur', () => {
    setTimeout(() => {
      const f = document.activeElement;
      if (f && f.tagName === 'IFRAME' && ((stage.classList.contains('music-tap') && f.id === 'ytMusic')
          || (stage.classList.contains('scene-tap') && f.id === 'ytScene'))) adLabel(ADS_TEXT);
    }, 0);
  });

  function onError(role, code) {
    const plan = media.plan;
    if (!plan) return;
    if (role === 'music') {
      // Music track gone: fall back to the scene's own sound, and say why.
      dropMusic(code === 101 || code === 150
        ? "The music video can't be played on other sites, so this is the scene's own sound."
        : "The music video couldn't be played, so this is the scene's own sound.");
      return;
    }
    setLoading(false);
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
    media.fadeVol = null;
    const audibleReady = sep() ? media.ready.music : media.ready.scene;
    if (sep() && media.scene && media.ready.scene) safe(() => media.scene.mute());
    if (media.gate) {
      if (media.music && media.ready.music) safe(() => media.music.mute());
      if (media.scene && media.ready.scene) safe(() => media.scene.mute());
      return;
    }
    if (audible && audibleReady) {
      safe(() => {
        audible.setVolume(fadedVolume());
        if (media.userMuted || vol === 0 || (touchScreen() && !media.soundOk)) audible.mute(); else audible.unMute();
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
    if (media.musicWait) {
      if (safe(() => media.scene.getPlayerState()) === YT_STATE.PLAYING) sceneDo('pause'); else wakeMusic();
      setTimeout(sync, 80);
      return;
    }
    const p = master();
    if (!p || media.gate) return;
    if (safe(() => p.getPlayerState()) === YT_STATE.PLAYING) safe(() => p.pauseVideo());
    else safe(() => p.playVideo());
  }

  function toggleSound() {
    if (media.musicWait) { wakeMusic(); setTimeout(sync, 80); return; }
    const p = master();
    if (!p) return;
    const muted = safe(() => p.isMuted());
    media.userMuted = !muted;
    if (muted) media.soundOk = true;
    if (muted) {
      if (currentVolume() === 0) setVolume(60);
      safe(() => p.unMute());
    } else safe(() => p.mute());
    setTimeout(sync, 80);
  }

  /* ---------- scrub bars ----------
     Our own bars, measured from the clip's start rather than the start of the YouTube video
     (a scene can sit 9 minutes into a 20-minute upload).
     With a separate music track there are two, and they look different on purpose:
       Music: gold, with a note icon. Moves the song.
       Scene: white, with a film icon. Moves the picture only; the song keeps going.
     Without a separate track there's one plain bar for the clip. */

  // Which player and which start/end each bar works on.
  function barTarget(kind) {
    if (!media.plan) return {};
    if (kind === 'music') return { p: media.ready.music ? media.music : null, spec: media.plan.music };
    if (kind === 'scene') return { p: media.ready.scene ? media.scene : null, spec: media.plan.scene };
    return { p: master(), spec: masterSpec() };
  }

  function makeBar(kind) {
    const label = kind === 'music' ? 'Music' : kind === 'scene' ? 'Scene' : null;
    const input = h('input', {
      class: 'seek', type: 'range', min: '0', max: '100', step: '1', value: '0',
      'aria-label': kind === 'music' ? 'Music position' : kind === 'scene' ? 'Scene position' : 'Position',
    });
    const time = h('span', { class: 'bar-time' }, '0:00');
    const bar = { kind, input, time, seeking: false };
    input.addEventListener('input', () => {
      bar.seeking = true;
      if (kind === 'scene') media.lock = false; // the picture now goes its own way until the next song
      const { p, spec } = barTarget(kind);
      if (p && spec) safe(() => p.seekTo((spec.start || 0) + Number(input.value), true));
    });
    input.addEventListener('change', () => { bar.seeking = false; });
    bar.row = h('div', { class: `scrub scrub-${kind}` },
      label ? h('span', { class: 'scrub-label' }, svg(kind === 'music' ? 'music' : 'film', 14), label) : null,
      input, time);
    return bar;
  }

  // Builds the bars to match what's playing (one bar, or music and scene).
  function refreshBars() {
    const st = songState;
    if (!st || !st.ui.barsBox || !media.plan) return;
    const kinds = media.plan.music ? ['music', 'scene'] : ['clip'];
    const sig = kinds.join(',');
    if (st.ui.barsSig === sig) return;
    st.ui.barsSig = sig;
    st.ui.bars = kinds.map(makeBar);
    st.ui.barsBox.classList.toggle('two', kinds.length > 1);
    st.ui.barsBox.replaceChildren(...st.ui.bars.map((b) => b.row));
    if (setBarRows(kinds.length)) placeStage(false);
  }

  // Phones give the scrub bars their own rows under the title, so the strip grows to fit them.
  // Returns true if that changed.
  function setBarRows(n) {
    const root = document.documentElement;
    const was = root.classList.contains('bars-one') ? 1 : root.classList.contains('bars-two') ? 2 : 0;
    root.classList.toggle('bars-one', n === 1);
    root.classList.toggle('bars-two', n === 2);
    return was !== n;
  }

  // Where a player is within its clip: { pos, len } in seconds.
  function clipPos(p, spec) {
    const start = spec.start || 0;
    const dur = safe(() => p.getDuration()) || 0;
    const end = spec.end || dur;
    const len = Math.max(0, end - start);
    const pos = Math.min(len, Math.max(0, (safe(() => p.getCurrentTime()) || 0) - start));
    return { pos, len };
  }

  function drawBar(bar) {
    const { p, spec } = barTarget(bar.kind);
    if (!p || !spec) return;
    const { pos, len } = clipPos(p, spec);
    const txt = len ? `${fmtTime(pos)} / ${fmtTime(len)}` : fmtTime(pos);
    if (bar.time.textContent !== txt) bar.time.textContent = txt;
    if (len && !bar.seeking) {
      bar.input.max = String(Math.floor(len));
      bar.input.value = String(Math.floor(pos));
      bar.input.style.setProperty('--p', `${(pos / len) * 100}%`);
      bar.input.setAttribute('aria-valuetext', `${fmtTime(pos)} of ${fmtTime(len)}`);
    }
  }

  // Play the current scene again from the top (repeat).
  // Repeat: the song goes back to its start without stopping. With a separate music track the
  // picture carries on where it is (it keeps looping on its own); only the song starts again.
  function repeatSong() {
    const p = master();
    const spec = masterSpec();
    if (!p || !spec || Date.now() - media.repeatAt < 1500) return;
    media.repeatAt = Date.now();
    if (songState) songState.ended = false;
    if (sep()) media.extra += clipPos(p, spec).len;
    safe(() => { p.seekTo(spec.start || 0, true); p.playVideo(); });
  }

  /* Ads: YouTube doesn't tell the site when an ad is on, so this guesses. A player that says it's
     playing while the video's own time doesn't move for 2 seconds is almost always showing an ad.
     Then a small "Ad playing" label shows. If it's the hidden music player, it's brought up over
     the scene so the ad can be seen and skipped, and the scene waits. */
  const adSeen = { scene: { t: -1, since: 0, u: -1 }, music: { t: -1, since: 0, u: -1 } };
  function adWatch() {
    let any = false;
    let musicAd = false;
    let sceneAd = false;
    for (const role of ['scene', 'music']) {
      const p = media[role];
      const a = adSeen[role];
      const st = p && media.ready[role] ? safe(() => p.getPlayerState()) : null;
      // iPhones: during ads the player says "not started" while its time counts up (the ad's own
      // clock). Seen in Mohad's screen recording, 2 Nov 2026.
      if (st === -1) {
        const t = safe(() => p.getCurrentTime()) || 0;
        if (a.u >= 0 && t > a.u + 0.05) { a.moved = a.moved || Date.now(); a.still = 0; }
        else if (a.u >= 0) { a.still = a.still || Date.now(); if (Date.now() - a.still > 1500) a.moved = 0; }
        a.u = t;
        a.t = -1; a.since = 0;
        if (a.moved && Date.now() - a.moved > 700) { any = true; if (role === 'music') musicAd = true; else sceneAd = true; }
        continue;
      }
      a.u = -1; a.moved = 0; a.still = 0;
      const playing = st === YT_STATE.PLAYING && !media.gate;
      if (!playing) { a.t = -1; a.since = 0; continue; }
      const t = safe(() => p.getCurrentTime()) || 0;
      if (Math.abs(t - a.t) > 0.01) { a.t = t; a.since = Date.now(); continue; }
      const wait = touchScreen() ? 1200 : 2000;
      // A scene standing still while it's locked to the music could just be waiting for the lock;
      // only count it once the lock has given up moving it (lockStill), or when it isn't locked.
      if (role === 'scene' && sep() && media.lock && (media.lockStill || 0) < 6 && !media.sceneAd) continue;
      if (Date.now() - a.since > wait) { any = true; if (role === 'music') musicAd = true; else sceneAd = true; }
    }
    // Ads on the music: the scene waits. Ads on the scene (with a separate music track): the music waits.
    // Still loading: stop loading and show them (they keep playing, muted until "Tap for sound").
    if (any && stage.classList.contains('loading')) {
      if (media.gate && sep() && musicAd) { clearGate(); media.musicWait = touchScreen(); media.lock = false; }
      setLoading(false);
    }
    if (musicAd && !media.musicAd) sceneDo('pause');
    if (!musicAd && media.musicAd && sep() && media.playing) sceneDo('play');
    const holdMusic = sceneAd && sep() && !musicAd;
    if (holdMusic && !media.sceneAd) { media.sceneAd = true; media.musicHeld = true; safe(() => media.music.pauseVideo()); }
    if (!holdMusic && media.sceneAd) {
      media.sceneAd = false;
      if (media.musicHeld && sep()) safe(() => media.music.playVideo());
      media.musicHeld = false;
    }
    media.musicAd = musicAd;
    if (any) adLabel('Ads playing. The song starts after them.');
    stage.classList.toggle('ad', any);
    stage.classList.toggle('music-ad', musicAd);
  }

  // ?debug in the link (before the #) shows what each player is doing, for testing on a phone.
  const DEBUG = /[?&]debug\b/.test(location.search);
  let debugBox = null;
  function debugTick() {
    if (!debugBox) {
      debugBox = h('pre', { class: 'debug-box' });
      document.body.append(debugBox);
    }
    const names = { '-1': 'not started', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };
    const line = (role) => {
      const p = media[role];
      if (!p) return `${role}: none`;
      if (!media.ready[role]) return `${role}: loading`;
      const st = safe(() => p.getPlayerState());
      const t = safe(() => p.getCurrentTime()) || 0;
      const vd = safe(() => p.getVideoData()) || {};
      return `${role}: ${names[st] || st} ${t.toFixed(1)}s / ${(safe(() => p.getDuration()) || 0).toFixed(0)}s${safe(() => p.isMuted()) ? ' muted' : ''} [${vd.video_id || '?'}]`;
    };
    debugBox.textContent = [line('scene'), line('music'),
      `ad ${!!media.musicAd}/${!!media.sceneAd}  tapShown ${!!media.musicTapShown}  gate ${media.gate ? 'on' : 'off'}  wait ${!!media.musicWait}  lock ${!!media.lock}  tapped ${!!media.tapTried}`,
      `musicStarted ${!!media.musicStarted}  soundOk ${!!media.soundOk}  plan music ${!!(media.plan && media.plan.music)}`].join('\n');
  }

  function tick() {
    if (DEBUG) debugTick();
    if (document.hidden) return;
    musicWatch();
    adWatch();
    // Phones, music not started yet: show its player small in the top right instead of hiding it,
    // so any ads on it play where they can be seen (muted until "Tap for sound").
    const peek = touchScreen() && sep() && !!media.musicWait && !media.musicTapShown && !media.musicAd;
    if (peek !== stage.classList.contains('music-peek')) {
      stage.classList.toggle('music-peek', peek);
      if (peek) adLabel('Music loading. Ads may play first.');
    }
    const plan = media.plan;
    // Same for the music track (YouTube can start it from 0:00 after an ad).
    if (plan && !media.gate && sep() && media.ready.music && plan.music.start
        && safe(() => media.music.getPlayerState()) === YT_STATE.PLAYING
        && (safe(() => media.music.getCurrentTime()) || 0) < plan.music.start - 1) {
      safe(() => media.music.seekTo(plan.music.start, true));
    }
    // Safety net: if the scene is playing from before its start (YouTube ignored the start time,
    // e.g. after an ad, or a phone that wouldn't jump until tapped), put it where it should be.
    if (plan && !media.gate && media.scene && media.ready.scene && plan.scene.start
        && safe(() => media.scene.getPlayerState()) === YT_STATE.PLAYING) {
      const t = safe(() => media.scene.getCurrentTime()) || 0;
      if (t < plan.scene.start - 1) {
        let to = plan.scene.start;
        if (sep() && media.lock && media.ready.music) {
          const mt = safe(() => media.music.getCurrentTime()) || 0;
          to = sceneAt(plan.scene, mt - (plan.music.start || 0) + media.extra, safe(() => media.scene.getDuration()) || 0);
        }
        safe(() => media.scene.seekTo(to, true));
      }
    }
    // Not locked (someone dragged the Scene bar): a scene with its own end just loops from its start.
    if (plan && sep() && !media.lock && plan.scene.end && media.scene && media.ready.scene) {
      const t = safe(() => media.scene.getCurrentTime()) || 0;
      if (t >= plan.scene.end) {
        media.sceneExpect = { action: 'play', at: Date.now() };
        safe(() => media.scene.seekTo(plan.scene.start || 0, true));
      }
    }
    // Locked: keep the picture where it should be for the song (wrapping round when the scene is shorter).
    if (plan && sep() && media.lock && !media.gate && media.playing && media.ready.scene && media.ready.music
        && safe(() => media.scene.getPlayerState()) === YT_STATE.PLAYING) {
      const mt = safe(() => media.music.getCurrentTime()) || 0;
      const st = safe(() => media.scene.getCurrentTime()) || 0;
      const want = sceneAt(plan.scene, mt - (plan.music.start || 0) + media.extra, safe(() => media.scene.getDuration()) || 0);
      // Is the scene moving by itself? (Ticks right after we moved it don't count.)
      if (media.lockPrev >= 0 && !media.lockSeeked) {
        media.lockStill = Math.abs(st - media.lockPrev) < 0.01 ? (media.lockStill || 0) + 1 : 0;
      }
      media.lockPrev = st;
      media.lockSeeked = false;
      // Stood still for 1.5 seconds of its own time while the music plays: probably an ad on the
      // scene. Stop moving it (so adWatch can spot the ad) until it moves on by itself again.
      if (Math.abs(st - want) > 0.8 && (media.lockStill || 0) < 6) {
        safe(() => media.scene.seekTo(want, true));
        media.lockSeeked = true;
      }
    } else { media.lockPrev = -1; media.lockSeeked = false; }
    sync();
  }

  function sync() {
    const st = songState;
    const p = master();
    if (!st || !p) return;
    const ui = st.ui;
    const waiting = media.musicWait;
    const playing = waiting
      ? safe(() => media.scene.getPlayerState()) === YT_STATE.PLAYING
      : safe(() => p.getPlayerState()) === YT_STATE.PLAYING;
    const muted = waiting || !!safe(() => p.isMuted());
    setIcon(ui.play, playing ? 'pause' : 'play', playing ? 'Pause' : 'Play');
    setIcon(dockPlay, playing ? 'pause' : 'play', playing ? 'Pause' : 'Play');
    setIcon(dockSound, muted ? 'muted' : 'sound', muted ? 'Turn sound on' : 'Mute');
    if (document.activeElement !== dockVol) { const v = currentVolume(); if (dockVol.value !== String(v)) { dockVol.value = String(v); dockVol.style.setProperty('--p', `${v}%`); } }
    if (ui.sound) {
      setIcon(ui.sound, muted ? 'muted' : 'sound', muted ? 'Turn sound on' : 'Mute');
      ui.sound.classList.toggle('nudge', muted && !media.userMuted && currentVolume() > 0);
    }
    // Phones: a "Tap for sound" button over the video while the sound is off because the phone wanted it off.
    stage.classList.toggle('need-sound', touchScreen() && playing && muted && !media.userMuted && currentVolume() > 0);
    // During ads the music player reports the ad's time, so the bars stay put.
    if (!media.musicAd && !media.sceneAd) for (const bar of ui.bars || []) drawBar(bar);
    const { pos, len } = clipPos(p, masterSpec());
    if (playing && repeatOn() && len > 3 && len - pos < 0.35) repeatSong();
    // Ends can have milliseconds; YouTube only stops on whole seconds, so stop it ourselves.
    else if (playing && !repeatOn() && masterSpec().end && len > 1 && pos >= len - 0.05) {
      safe(() => p.pauseVideo());
      songEnded();
    }
    if (len > 1) nearEnd(len - pos, playing);
  }

  dockPlay.addEventListener('click', togglePlay);
  // The small player's bar: previous, play/pause, next, and sound (volume slider on hover).
  dockSound.addEventListener('click', toggleSound);
  dockVol.addEventListener('input', () => setVolume(Number(dockVol.value)));

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
    if (repeatOn()) { repeatSong(); return; }
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

  function cloudPool(stories) {
    const short = (stories || []).filter((c) => c.text && c.text.length <= CLOUD_MAX_CHARS);
    // Best 30 by score, in a random order.
    return shuffle([...short].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 30));
  }

  // Every comment shows once before any comes round again, and the last few shown
  // never come straight back when the list starts over.
  function refillClouds() {
    const fresh = cloudPool(songState.stories);
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
    if (clouds.song !== songState.stories) {
      clouds.song = songState.stories;
      clouds.recent = [];
      clouds.pool = [];
      refillClouds();
      clouds.started = false;
    }
    if (!clouds.pool.length && !cloudPool(songState.stories).length) return;
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

    const el = h('div', { class: 'cloud' }, h('div', { class: 'cloud-in' }, h('p', null, c.text), metaEl(c, true)));
    el.firstChild.style.setProperty('--tilt', `${((Math.random() * 2 - 1) * 3).toFixed(2)}deg`);
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

  const soundsPanel = $('soundsPanel');
  const soundsPads = $('soundsPads');
  // The Sounds button: a round gold button with a little burst. It lives in the strip under the video.
  const soundsBtn = h('button', { class: 'fx-btn', type: 'button', 'aria-label': 'Sounds', title: 'Sounds', 'aria-expanded': 'false', 'aria-controls': 'soundsPanel', hidden: true });
  soundsBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 10v4h3l4 3.5v-11L7 10H4z" fill="currentColor"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19.5 3.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor"/></svg>';
  const soundCache = new Map();

  // Called on every page: the button only shows for a game that has sounds.
  // Sounds: a song's own list (the ones ticked for it in the admin page). The button sits at the
  // right end of the strip under the video, only on songs that have sounds, and opens a panel of
  // pads from the right. Each pad lights up while its sound plays. Sounds play over each other.
  const FX_COLOURS = ['#e8c27a', '#7fd1c7', '#e89a9a', '#a99be8', '#9fd47f', '#e8b07a'];
  let soundsList = [];
  function setSounds(list) {
    closeSounds();
    soundsList = (list || []).filter((x) => x && x.file);
    soundsBtn.hidden = !soundsList.length;
    soundsPads.replaceChildren(...soundsList.map((snd, i) => {
      const pad = h('button', { type: 'button', class: 'fx-pad', style: `--fx:${FX_COLOURS[i % FX_COLOURS.length]}` },
        h('span', { class: 'fx-wave', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
        h('span', { class: 'fx-name' }, snd.label || 'Sound'));
      pad.addEventListener('click', (e) => { e.stopPropagation(); playSound(snd.file, pad); });
      return pad;
    }));
  }

  function playSound(file, pad) {
    let base = soundCache.get(file);
    if (!base) { base = new Audio(file); base.preload = 'auto'; soundCache.set(file, base); }
    // A copy each time, so pressing quickly plays them over each other.
    const a = base.cloneNode();
    a.volume = Math.max(0.05, currentVolume() / 100);
    if (pad) {
      pad.classList.remove('hit');
      void pad.offsetWidth; // restart the press ring
      pad.classList.add('hit', 'playing');
      pad.dataset.n = String((Number(pad.dataset.n) || 0) + 1);
      const done = () => { pad.dataset.n = String(Math.max(0, (Number(pad.dataset.n) || 1) - 1)); if (pad.dataset.n === '0') pad.classList.remove('playing'); };
      a.addEventListener('ended', done, { once: true });
      a.addEventListener('error', done, { once: true });
    }
    a.play().catch(() => { if (pad) pad.classList.remove('playing'); });
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
    if (open) for (const snd of soundsList) if (!soundCache.has(snd.file)) {
      const a = new Audio(snd.file); a.preload = 'auto'; soundCache.set(snd.file, a);
    }
  });
  document.addEventListener('click', (e) => {
    if (!soundsPanel.hidden && !soundsPanel.contains(e.target)) closeSounds();
    // Close the scene list when tapping anywhere else.
    for (const w of document.querySelectorAll('.scenes-wrap.open')) {
      if (!w.contains(e.target)) { w.classList.remove('open'); const b = w.querySelector('.scenes-btn'); if (b) b.setAttribute('aria-expanded', 'false'); }
    }
  });
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
