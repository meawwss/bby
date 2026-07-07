function hexToRgba(hex, alpha) {
  const clean = (hex || '#000000').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const bigint = parseInt(full, 16) || 0;
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function createMarquee(containerEl, textEl, speed, pauseMs) {
  return {
    containerEl, textEl,
    speed: speed || 22,
    pauseMs: pauseMs || 1200,
    raf: null, offset: 0, overflow: 0,
    state: 'pausing-start', pauseUntil: 0, lastTime: null,

    reset() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.offset = 0;
      this.textEl.style.transform = 'translateX(0px)';
      this.lastTime = null;
      this.state = 'pausing-start';
      requestAnimationFrame(() => {
        this.overflow = this.textEl.scrollWidth - this.containerEl.clientWidth;
        this.pauseUntil = performance.now() + this.pauseMs;
        if (this.overflow > 8) {
          this.containerEl.classList.add('np-scrolling');
          this.raf = requestAnimationFrame((t) => this.tick(t));
        } else {
          this.containerEl.classList.remove('np-scrolling');
        }
      });
    },

    tick(time) {
      if (this.lastTime === null) this.lastTime = time;
      const dt = (time - this.lastTime) / 1000;
      this.lastTime = time;
      if (this.state === 'pausing-start' || this.state === 'pausing-end') {
        if (time >= this.pauseUntil) {
          this.state = this.state === 'pausing-start' ? 'scrolling-left' : 'scrolling-right';
        }
      } else if (this.state === 'scrolling-left') {
        this.offset += this.speed * dt;
        if (this.offset >= this.overflow) {
          this.offset = this.overflow;
          this.state = 'pausing-end';
          this.pauseUntil = time + this.pauseMs;
        }
        this.textEl.style.transform = `translateX(-${Math.round(this.offset)}px)`;
      } else if (this.state === 'scrolling-right') {
        this.offset -= this.speed * dt;
        if (this.offset <= 0) {
          this.offset = 0;
          this.state = 'pausing-start';
          this.pauseUntil = time + this.pauseMs;
        }
        this.textEl.style.transform = `translateX(-${Math.round(this.offset)}px)`;
      }
      this.raf = requestAnimationFrame((t) => this.tick(t));
    },
  };
}

/* ============================================================
   SYSTÈME D'ÉTOILES (ambiance + apparition + disparition)
   ============================================================ */
function createStardust(ambientLayer, burstLayer) {
  const rand = (a, b) => a + Math.random() * (b - a);

  function sparkleSVG(size, blur) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 0 ' + blur + 'px rgba(255,255,255,0.95))">'
      + '<path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill="#ffffff"/></svg>';
  }

  // ---------- Ambiance : petites vagues d'étoiles pendant la lecture ----------
  let ambientRunning = false;
  let ambientTimer = null;

  function ambientDot() {
    const s = document.createElement('div');
    s.className = 'np-fx-dot';
    const size = rand(1, 2.4);
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = rand(3, 97) + '%';
    s.style.top = rand(10, 90) + '%';
    s.style.boxShadow = size > 1.9
      ? '0 0 4px rgba(255,255,255,0.9),0 0 8px rgba(200,220,255,0.6)'
      : '0 0 3px rgba(255,255,255,0.85)';
    const dx = rand(-10, 10), dy = rand(-8, 8), peak = rand(0.4, 0.72), dur = rand(1500, 2300), delay = rand(0, 600);
    s.animate([
      { transform: 'translate(0,0) scale(0.25)', opacity: 0 },
      { transform: 'translate(' + (dx * 0.4) + 'px,' + (dy * 0.4) + 'px) scale(1)', opacity: peak, offset: 0.4 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0.4)', opacity: 0 }
    ], { duration: dur, delay: delay, easing: 'ease-in-out', fill: 'forwards' });
    ambientLayer.appendChild(s);
    setTimeout(() => s.remove(), dur + delay + 80);
  }

  function ambientSpk() {
    const w = document.createElement('div');
    w.className = 'np-fx-spk';
    const size = rand(6, 10);
    w.style.left = rand(5, 95) + '%';
    w.style.top = rand(12, 88) + '%';
    w.innerHTML = sparkleSVG(size, 3);
    const peak = rand(0.5, 0.8), dur = rand(1600, 2300), delay = rand(0, 600), rot = rand(-40, 40);
    w.animate([
      { transform: 'scale(0) rotate(0deg)', opacity: 0 },
      { transform: 'scale(1) rotate(' + (rot * 0.5) + 'deg)', opacity: peak, offset: 0.4 },
      { transform: 'scale(0.4) rotate(' + rot + 'deg)', opacity: 0 }
    ], { duration: dur, delay: delay, easing: 'ease-in-out', fill: 'forwards' });
    ambientLayer.appendChild(w);
    setTimeout(() => w.remove(), dur + delay + 80);
  }

  function ambientWave() {
    if (!ambientRunning) return;
    const dots = Math.round(rand(12, 16));
    const spks = Math.round(rand(3, 4));
    for (let i = 0; i < dots; i++) setTimeout(ambientDot, rand(0, 700));
    for (let j = 0; j < spks; j++) setTimeout(ambientSpk, rand(0, 700));
    ambientTimer = setTimeout(ambientWave, rand(3200, 4800));
  }

  function startAmbient() {
    if (ambientRunning) return;
    ambientRunning = true;
    ambientWave();
  }
  function stopAmbient() {
    ambientRunning = false;
    if (ambientTimer) { clearTimeout(ambientTimer); ambientTimer = null; }
  }

  // ---------- Burst : apparition ('in') / disparition ('out') ----------
  function burstDot(dir) {
    const s = document.createElement('div');
    s.className = 'np-fx-dot';
    const size = rand(1, 2.8);
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = rand(2, 98) + '%';
    s.style.top = rand(6, 94) + '%';
    s.style.boxShadow = size > 2
      ? '0 0 5px rgba(255,255,255,0.95),0 0 10px rgba(200,220,255,0.7)'
      : '0 0 3px rgba(255,255,255,0.9)';
    const dx = rand(-22, 22), dy = rand(-16, 16), dur = rand(0.9, 1.5) * 1000, delay = rand(0, 0.5) * 1000;
    const kf = dir === 'out'
      ? [{ transform: 'translate(0,0) scale(0.2)', opacity: 0 },
         { transform: 'translate(' + (dx * 0.4) + 'px,' + (dy * 0.4) + 'px) scale(1)', opacity: 1, offset: 0.3 },
         { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0.4)', opacity: 0 }]
      : [{ transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0.4)', opacity: 0 },
         { transform: 'translate(' + (dx * 0.4) + 'px,' + (dy * 0.4) + 'px) scale(1)', opacity: 1, offset: 0.6 },
         { transform: 'translate(0,0) scale(0.3)', opacity: 0 }];
    s.animate(kf, { duration: dur, delay: delay, easing: dir === 'out' ? 'cubic-bezier(0.25,0.6,0.3,1)' : 'cubic-bezier(0.5,0,0.5,1)', fill: 'forwards' });
    burstLayer.appendChild(s);
    setTimeout(() => s.remove(), dur + delay + 100);
  }

  function burstSpk(dir) {
    const w = document.createElement('div');
    w.className = 'np-fx-spk';
    const size = rand(7, 12);
    w.style.left = rand(4, 96) + '%';
    w.style.top = rand(8, 92) + '%';
    w.innerHTML = sparkleSVG(size, 4);
    const dx = rand(-16, 16), dy = rand(-12, 12), rot = rand(-60, 60), dur = rand(1.0, 1.5) * 1000, delay = rand(0, 0.45) * 1000;
    const kf = dir === 'out'
      ? [{ transform: 'translate(0,0) scale(0) rotate(0deg)', opacity: 0 },
         { transform: 'translate(' + (dx * 0.4) + 'px,' + (dy * 0.4) + 'px) scale(1) rotate(' + (rot * 0.4) + 'deg)', opacity: 1, offset: 0.35 },
         { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0.3) rotate(' + rot + 'deg)', opacity: 0 }]
      : [{ transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0.3) rotate(' + rot + 'deg)', opacity: 0 },
         { transform: 'translate(' + (dx * 0.4) + 'px,' + (dy * 0.4) + 'px) scale(1) rotate(' + (rot * 0.6) + 'deg)', opacity: 1, offset: 0.65 },
         { transform: 'translate(0,0) scale(0) rotate(' + rot + 'deg)', opacity: 0 }];
    w.animate(kf, { duration: dur, delay: delay, easing: 'ease-out', fill: 'forwards' });
    burstLayer.appendChild(w);
    setTimeout(() => w.remove(), dur + delay + 100);
  }

  function fire(dir) {
    burstLayer.innerHTML = '';
    for (let i = 0; i < 38; i++) setTimeout(() => burstDot(dir), rand(0, 600));
    for (let j = 0; j < 9; j++) setTimeout(() => burstSpk(dir), rand(0, 550));
  }

  return { startAmbient, stopAmbient, fire };
}

window.addEventListener('onWidgetLoad', function (obj) {
  const fieldData = obj.detail.fieldData;

  // ===== Identifiants Spotify =====
  const CLIENT_ID = fieldData.spotifyClientId;
  const REFRESH_TOKEN = fieldData.spotifyRefreshToken;
  const REFRESH_INTERVAL = (fieldData.refreshSeconds || 4) * 1000;

  const bool = (v, def) => (v === undefined || v === '') ? def : (v === 'true' || v === true);
  const num = (v, def) => (v === undefined || v === '') ? def : parseFloat(v);
  const int = (v, def) => (v === undefined || v === '') ? def : parseInt(v, 10);

  // ===== Options d'animation =====
  const ENABLE_APPEAR    = bool(fieldData.enableAppear, true);
  const ENABLE_DISAPPEAR = bool(fieldData.enableDisappear, true);
  const ENABLE_AMBIENT   = bool(fieldData.enableAmbient, true);
  const HIDE_DELAY       = num(fieldData.hideDelaySeconds, 20) * 1000;
  const SHOW_LAST_TRACK  = bool(fieldData.showLastTrack, true);

  // ===== Apparence =====
  const CARD_WIDTH   = int(fieldData.cardWidth, 426);
  const CARD_GAP     = int(fieldData.cardGap, 12);
  const TITLE_ZONE   = int(fieldData.titleZoneWidth, 155);
  const ARTIST_ZONE  = int(fieldData.artistZoneWidth, 100);
  const CARD_BG_COLOR = fieldData.cardBgColor || '#c6bab9';
  const CARD_BG_OPACITY = num(fieldData.cardBgOpacity, 0.9);
  const BLUR = int(fieldData.cardBlur, 14);
  const BORDER_COLOR = fieldData.borderColor || '#000000';
  const BORDER_OPACITY = num(fieldData.borderOpacity, 0.8);
  const BORDER_WIDTH = num(fieldData.borderWidth, 3);
  const RADIUS = int(fieldData.cardRadius, 10);
  const PLAY_COLOR = fieldData.playColor || '#24201c';
  const ICON_SIZE = num(fieldData.iconSize, 18);
  const ICON_GLOW = num(fieldData.iconGlow, 2);
  const TITLE_COLOR = fieldData.titleColor || '#191919';
  const ARTIST_COLOR = fieldData.artistColor || '#191919';
  const TEXT_STROKE = fieldData.textStrokeColor || '#ffffff';
  const DIVIDER_COLOR = fieldData.dividerColor || '#ffffff';
  const TITLE_SIZE = num(fieldData.titleSize, 14);
  const ARTIST_SIZE = num(fieldData.artistSize, 14);
  const TITLE_STROKE_W = num(fieldData.titleStrokeWidth, 0.3);
  const ARTIST_STROKE_W = num(fieldData.artistStrokeWidth, 0.3);
  const PLACEHOLDER_TITLE = fieldData.placeholderTitle || 'Aucune musique';
  const PLACEHOLDER_ARTIST = fieldData.placeholderArtist || '—';

  const root = document.documentElement.style;
  root.setProperty('--np-card-width', CARD_WIDTH + 'px');
  root.setProperty('--np-gap', CARD_GAP + 'px');
  root.setProperty('--np-title-zone', TITLE_ZONE + 'px');
  root.setProperty('--np-artist-zone', ARTIST_ZONE + 'px');
  root.setProperty('--np-card-bg', hexToRgba(CARD_BG_COLOR, CARD_BG_OPACITY));
  root.setProperty('--np-blur', BLUR + 'px');
  root.setProperty('--np-border-color', hexToRgba(BORDER_COLOR, BORDER_OPACITY));
  root.setProperty('--np-border-width', BORDER_WIDTH + 'px');
  root.setProperty('--np-radius', RADIUS + 'px');
  root.setProperty('--np-play-color', PLAY_COLOR);
  root.setProperty('--np-icon-size', ICON_SIZE + 'px');
  root.setProperty('--np-icon-glow', ICON_GLOW + 'px');
  root.setProperty('--np-title-color', TITLE_COLOR);
  root.setProperty('--np-artist-color', ARTIST_COLOR);
  root.setProperty('--np-text-stroke', TEXT_STROKE);
  root.setProperty('--np-divider-color', DIVIDER_COLOR);

  // Génère un contour "ombres multiples" (net dans OBS) à partir d'une épaisseur.
  // On empile 8 ombres autour de la lettre + une légère ombre portée sombre.
  function buildOutline(width, color, dropAlpha) {
    const w = Math.max(0, width);
    if (w <= 0) return `0 1px 1.5px rgba(0,0,0,${dropAlpha})`;
    const dirs = [
      [-w, -w], [w, -w], [-w, w], [w, w],
      [0, -w], [0, w], [-w, 0], [w, 0],
    ];
    // demi-pas pour combler les angles quand le contour est épais (rendu plus plein)
    const h = w * 0.6;
    const halfDirs = [[-h, -h], [h, -h], [-h, h], [h, h]];
    const parts = dirs.concat(halfDirs).map(([x, y]) =>
      `${x.toFixed(2)}px ${y.toFixed(2)}px 0 ${color}`
    );
    parts.push(`0 1px 1.5px rgba(0,0,0,${dropAlpha})`); // légère ombre portée pour le relief
    return parts.join(', ');
  }

  root.setProperty('--np-title-outline', buildOutline(TITLE_STROKE_W, TEXT_STROKE, 0.28));
  root.setProperty('--np-artist-outline', buildOutline(ARTIST_STROKE_W, TEXT_STROKE, 0.22));
  root.setProperty('--np-title-size', TITLE_SIZE + 'px');
  root.setProperty('--np-artist-size', ARTIST_SIZE + 'px');

  const cardEl = document.getElementById('now-playing-card');
  const titleEl = document.getElementById('np-title');
  const artistEl = document.getElementById('np-artist');
  const progressBarEl = document.getElementById('np-progress-bar');
  const ambientLayer = document.getElementById('np-fx-ambient');
  const burstLayer = document.getElementById('np-fx-burst');

  const titleMarquee = createMarquee(document.querySelector('.np-title-wrap'), titleEl);
  const artistMarquee = createMarquee(document.querySelector('.np-artist-wrap'), artistEl);
  const stardust = createStardust(ambientLayer, burstLayer);

  // Mode démo : si les identifiants Spotify sont absents, on affiche un morceau
  // fictif avec toutes les animations, pour prévisualiser le visuel sans Spotify.
  const DEMO_MODE = (!CLIENT_ID || !REFRESH_TOKEN);
  if (DEMO_MODE) {
    console.warn('Widget Spotify : MODE DÉMO (identifiants absents) — affichage fictif pour prévisualiser le rendu. Remplis Client ID + Refresh Token pour la vraie lecture.');
  }

  // ===== Token =====
  let accessToken = null;
  let tokenExpiresAt = 0;
  async function getAccessToken() {
    if (accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken;
    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN, client_id: CLIENT_ID }),
      });
      if (!res.ok) { console.error('Spotify token HTTP', res.status); return null; }
      const data = await res.json();
      if (data.access_token) {
        accessToken = data.access_token;
        tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
        return accessToken;
      }
      console.error('Spotify token error:', data);
      return null;
    } catch (e) { console.error('Erreur token Spotify:', e); return null; }
  }

  async function spotifyGet(url) {
    const token = await getAccessToken();
    if (!token) return { status: 0, data: null };
    try {
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (res.status === 204) return { status: 204, data: null };
      if (!res.ok) return { status: res.status, data: null };
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    } catch (e) { console.error('Erreur Spotify GET:', e); return { status: 0, data: null }; }
  }

  // ===== État lecture + barre exacte =====
  const st = { key: null, durationMs: 0, anchorMs: 0, anchorAt: 0, isPlaying: false, hasContent: false };
  let renderTimer = null;
  function ensureRenderLoop() {
    if (renderTimer) return;
    renderTimer = setInterval(() => {
      if (st.durationMs <= 0) return;
      let shown = st.anchorMs;
      if (st.isPlaying) shown += (Date.now() - st.anchorAt);
      const pct = Math.max(0, Math.min(100, (shown / st.durationMs) * 100));
      progressBarEl.style.width = pct + '%';
    }, 200);
  }
  function setIdle(idle) { cardEl.classList.toggle('np-idle', idle); }

  // ===== Visibilité (apparition / disparition étoilée) =====
  let visShown = false;            // la carte est-elle affichée ?
  let visAnimating = false;
  let hideTimer = null;

  function appear() {
    if (visShown) return;
    visShown = true;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    cardEl.classList.remove('np-hidden', 'np-disappearing');
    if (ENABLE_APPEAR) {
      visAnimating = true;
      void cardEl.offsetWidth;
      cardEl.classList.add('np-appearing');
      stardust.fire('in');
      setTimeout(() => { cardEl.classList.remove('np-appearing'); visAnimating = false; }, 1650);
    }
    if (ENABLE_AMBIENT) stardust.startAmbient();
  }

  function disappear() {
    if (!visShown) return;
    visShown = false;
    stardust.stopAmbient();
    if (ENABLE_DISAPPEAR) {
      visAnimating = true;
      cardEl.classList.remove('np-appearing');
      void cardEl.offsetWidth;
      cardEl.classList.add('np-disappearing');
      stardust.fire('out');
      setTimeout(() => {
        cardEl.classList.add('np-hidden');
        cardEl.classList.remove('np-disappearing');
        visAnimating = false;
      }, 1720);
    } else {
      cardEl.classList.add('np-hidden');
    }
  }

  function scheduleHide() {
    if (!ENABLE_DISAPPEAR) return;      // si désactivé : on garde la carte visible
    if (hideTimer || !visShown) return;
    hideTimer = setTimeout(() => { hideTimer = null; disappear(); }, HIDE_DELAY);
  }
  function cancelHide() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }

  // ===== Rendu texte =====
  function renderTrack(name, artistName) {
    const key = name + '|' + artistName;
    if (key !== st.key) {
      st.key = key;
      titleEl.textContent = name || '';
      artistEl.textContent = artistName || '';
      titleMarquee.reset();
      artistMarquee.reset();
    }
    st.hasContent = true;
  }
  function showPlaceholder() {
    if (st.key !== '__ph__') {
      st.key = '__ph__';
      titleEl.textContent = PLACEHOLDER_TITLE;
      artistEl.textContent = PLACEHOLDER_ARTIST;
      titleMarquee.reset();
      artistMarquee.reset();
    }
    st.durationMs = 0;
    st.isPlaying = false;
    progressBarEl.style.width = '0%';
  }

  function extractArtist(item) {
    if (item.artists && item.artists.length) return item.artists.map(a => a.name).join(', ');
    if (item.show && item.show.name) return item.show.name;
    return '';
  }

  async function fetchLastPlayed() {
    const { data } = await spotifyGet('https://api.spotify.com/v1/me/player/recently-played?limit=1');
    const item = data && data.items && data.items[0] && data.items[0].track;
    if (!item) return false;
    renderTrack(item.name, extractArtist(item));
    st.durationMs = item.duration_ms || 0;
    st.anchorMs = st.durationMs;
    st.anchorAt = Date.now();
    st.isPlaying = false;
    progressBarEl.style.width = '100%';
    return true;
  }

  // ===== Boucle principale =====
  async function poll() {
    const { status, data } = await spotifyGet('https://api.spotify.com/v1/me/player?additional_types=track,episode');

    const playing = status === 200 && data && data.item && data.is_playing;

    if (playing) {
      cancelHide();
      const item = data.item;
      st.isPlaying = true;
      st.durationMs = item.duration_ms || 0;
      st.anchorMs = (typeof data.progress_ms === 'number') ? data.progress_ms : 0;
      st.anchorAt = Date.now();
      renderTrack(item.name, extractArtist(item));
      ensureRenderLoop();
      setIdle(false);
      appear();                        // affiche (avec étoiles) si masqué
      return;
    }

    // --- Pas de lecture : pause, arrêt, ou rien d'actif ---
    st.isPlaying = false;
    setIdle(true);

    // Contenu affiché pendant la période de grâce (avant disparition)
    if (status === 200 && data && data.item) {
      // en pause : on garde le morceau courant, barre figée à sa position
      const item = data.item;
      st.durationMs = item.duration_ms || 0;
      st.anchorMs = (typeof data.progress_ms === 'number') ? data.progress_ms : st.anchorMs;
      st.anchorAt = Date.now();
      renderTrack(item.name, extractArtist(item));
      ensureRenderLoop();
    } else {
      // 204 / rien : dernier son connu, ou placeholder
      if (SHOW_LAST_TRACK && !st.hasContent) {
        const ok = await fetchLastPlayed();
        if (!ok) showPlaceholder();
      } else if (!st.hasContent) {
        showPlaceholder();
      }
    }

    // Gestion de la disparition différée
    if (visShown) {
      scheduleHide();
    } else if (!ENABLE_DISAPPEAR) {
      // si la disparition est désactivée, on s'assure que la carte est visible
      appear();
    }
  }

  // ===== Mode démo (sans Spotify) =====
  function startDemo() {
    st.isPlaying = true;
    st.durationMs = 22000;          // fausse durée (la barre boucle sur ~22s)
    st.anchorMs = 0;
    st.anchorAt = Date.now();
    renderTrack('Blinding Lights', 'The Weeknd');
    ensureRenderLoop();
    setIdle(false);
    appear();

    // La barre boucle en continu
    setInterval(() => {
      if (Date.now() - st.anchorAt > st.durationMs) st.anchorAt = Date.now();
    }, 400);

    // Si la disparition est activée, on montre le cycle complet apparition/disparition
    if (ENABLE_DISAPPEAR) {
      const cycle = () => {
        setTimeout(() => {
          setIdle(true);
          disappear();
          setTimeout(() => {
            st.anchorAt = Date.now();
            setIdle(false);
            appear();
            cycle();
          }, HIDE_DELAY > 6000 ? 4500 : HIDE_DELAY);  // pause avant de réapparaître
        }, 11000);  // durée "lecture" avant de disparaître
      };
      cycle();
    }
  }

  // ===== Démarrage =====
  // La carte démarre masquée (classe np-hidden dans le HTML).
  if (DEMO_MODE) {
    startDemo();
    return;
  }

  // Si apparition ET disparition désactivées : on affiche direct au chargement.
  if (!ENABLE_DISAPPEAR && !ENABLE_APPEAR) {
    cardEl.classList.remove('np-hidden');
    visShown = true;
    if (ENABLE_AMBIENT) stardust.startAmbient();
  }
  ensureRenderLoop();
  poll();
  setInterval(poll, REFRESH_INTERVAL);
});