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
        // Seuil à 8px : le texte a 6px de padding réservé pour le contour,
        // on ne déclenche le défilement que si ça déborde vraiment au-delà.
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

window.addEventListener('onWidgetLoad', function (obj) {
  const fieldData = obj.detail.fieldData;

  const LASTFM_API_KEY = fieldData.lastfmApiKey;
  const LASTFM_USERNAME = fieldData.lastfmUsername;
  const REFRESH_INTERVAL = (fieldData.refreshSeconds || 8) * 1000;

  // --- Couleurs / apparence (Fields) ---
  const CARD_WIDTH = fieldData.cardWidth !== undefined && fieldData.cardWidth !== ''
    ? parseInt(fieldData.cardWidth, 10) : 426;
  const CARD_GAP = fieldData.cardGap !== undefined && fieldData.cardGap !== ''
    ? parseInt(fieldData.cardGap, 10) : 12;
  const TITLE_ZONE = fieldData.titleZoneWidth !== undefined && fieldData.titleZoneWidth !== ''
    ? parseInt(fieldData.titleZoneWidth, 10) : 155;
  const ARTIST_ZONE = fieldData.artistZoneWidth !== undefined && fieldData.artistZoneWidth !== ''
    ? parseInt(fieldData.artistZoneWidth, 10) : 100;
  const CARD_BG_COLOR = fieldData.cardBgColor || '#c6bab9';
  const CARD_BG_OPACITY = fieldData.cardBgOpacity !== undefined && fieldData.cardBgOpacity !== ''
    ? parseFloat(fieldData.cardBgOpacity) : 0.45;
  const BLUR = fieldData.cardBlur !== undefined && fieldData.cardBlur !== ''
    ? parseInt(fieldData.cardBlur, 10) : 14;
  const BORDER_COLOR = fieldData.borderColor || '#000000';
  const BORDER_OPACITY = fieldData.borderOpacity !== undefined && fieldData.borderOpacity !== ''
    ? parseFloat(fieldData.borderOpacity) : 0.8;
  const BORDER_WIDTH = fieldData.borderWidth !== undefined && fieldData.borderWidth !== ''
    ? parseFloat(fieldData.borderWidth) : 2.3;
  const RADIUS = fieldData.cardRadius !== undefined && fieldData.cardRadius !== ''
    ? parseInt(fieldData.cardRadius, 10) : 10;

  const PLAY_COLOR = fieldData.playColor || '#24201c';
  const ICON_SIZE = fieldData.iconSize !== undefined && fieldData.iconSize !== ''
    ? parseFloat(fieldData.iconSize) : 18;
  const TITLE_COLOR = fieldData.titleColor || '#191919';
  const ARTIST_COLOR = fieldData.artistColor || '#191919';
  const TEXT_STROKE = fieldData.textStrokeColor || '#ffffff';
  const DIVIDER_COLOR = fieldData.dividerColor || '#ffffff';

  const TITLE_SIZE = fieldData.titleSize !== undefined && fieldData.titleSize !== ''
    ? parseFloat(fieldData.titleSize) : 13;
  const ARTIST_SIZE = fieldData.artistSize !== undefined && fieldData.artistSize !== ''
    ? parseFloat(fieldData.artistSize) : 13;
  const TITLE_STROKE_W = fieldData.titleStrokeWidth !== undefined && fieldData.titleStrokeWidth !== ''
    ? parseFloat(fieldData.titleStrokeWidth) : 1;
  const ARTIST_STROKE_W = fieldData.artistStrokeWidth !== undefined && fieldData.artistStrokeWidth !== ''
    ? parseFloat(fieldData.artistStrokeWidth) : 0.8;

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
  root.setProperty('--np-title-color', TITLE_COLOR);
  root.setProperty('--np-artist-color', ARTIST_COLOR);
  root.setProperty('--np-text-stroke', TEXT_STROKE);
  root.setProperty('--np-divider-color', DIVIDER_COLOR);
  root.setProperty('--np-title-size', TITLE_SIZE + 'px');
  root.setProperty('--np-artist-size', ARTIST_SIZE + 'px');
  root.setProperty('--np-title-stroke-width', TITLE_STROKE_W + 'px');
  root.setProperty('--np-artist-stroke-width', ARTIST_STROKE_W + 'px');

  if (!LASTFM_API_KEY || !LASTFM_USERNAME) {
    console.error('Widget Now Playing : clé API ou pseudo Last.fm manquant dans les Fields.');
    return;
  }

  const cardEl = document.getElementById('now-playing-card');
  const titleEl = document.getElementById('np-title');
  const artistEl = document.getElementById('np-artist');
  const progressBarEl = document.getElementById('np-progress-bar');

  const titleMarquee = createMarquee(document.querySelector('.np-title-wrap'), titleEl);
  const artistMarquee = createMarquee(document.querySelector('.np-artist-wrap'), artistEl);

  const FALLBACK_DURATION = 210000; // estimation si Last.fm ne connaît pas la durée (~3.5 min)

  // La barre avance uniquement quand playing = true. Le temps est accumulé,
  // donc quand le son s'arrête la barre se fige (elle ne grimpe plus).
  const current = { key: null, durationMs: 0, elapsedMs: 0, playing: false, lastTick: null };
  let hasPlayed = false;
  let renderTimer = null;

  async function fetchTrackDuration(artist, track) {
    try {
      const url = `https://ws.audioscrobbler.com/2.0/?method=track.getinfo&api_key=${LASTFM_API_KEY}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&username=${LASTFM_USERNAME}&format=json`;
      const res = await fetch(url);
      const data = await res.json();
      const duration = parseInt(data?.track?.duration, 10);
      return Number.isFinite(duration) && duration > 0 ? duration : 0;
    } catch (err) {
      return 0;
    }
  }

  function ensureRenderLoop() {
    if (renderTimer) return;
    renderTimer = setInterval(() => {
      if (current.playing && current.lastTick !== null) {
        const now = Date.now();
        current.elapsedMs += now - current.lastTick;
        current.lastTick = now;
        const dur = current.durationMs > 0 ? current.durationMs : FALLBACK_DURATION;
        const pct = Math.min(100, (current.elapsedMs / dur) * 100);
        progressBarEl.style.width = pct + '%';
      }
    }, 250);
  }

  function showPlaceholder() {
    titleEl.textContent = PLACEHOLDER_TITLE;
    artistEl.textContent = PLACEHOLDER_ARTIST;
    cardEl.classList.add('visible');
    cardEl.classList.add('np-idle');
    titleMarquee.reset();
    artistMarquee.reset();
    current.key = null;
    current.playing = false;
    current.lastTick = null;
    current.elapsedMs = 0;
    progressBarEl.style.width = '0%';
  }

  async function fetchNowPlaying() {
    try {
      const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${LASTFM_USERNAME}&api_key=${LASTFM_API_KEY}&format=json&limit=1`;
      const res = await fetch(url);
      const data = await res.json();

      const track = data?.recenttracks?.track?.[0];
      if (!track) return;

      const nowPlaying = track['@attr']?.nowplaying === 'true';
      const artistName = track.artist['#text'];
      const key = track.name + '|' + artistName;

      if (nowPlaying) {
        cardEl.classList.remove('np-idle'); // musique active -> plein éclat
        if (key !== current.key) {
          // Nouveau morceau : on repart de zéro.
          current.key = key;
          current.durationMs = 0;
          current.elapsedMs = 0;
          current.playing = true;
          current.lastTick = Date.now();
          hasPlayed = true;

          titleEl.textContent = track.name;
          artistEl.textContent = artistName;
          cardEl.classList.add('visible');
          titleMarquee.reset();
          artistMarquee.reset();
          progressBarEl.style.width = '0%';
          ensureRenderLoop();

          current.durationMs = await fetchTrackDuration(artistName, track.name);
        } else if (!current.playing) {
          // Même morceau qui reprend après un arrêt : on continue là où on s'était figé.
          current.playing = true;
          current.lastTick = Date.now();
        }
      } else {
        // Plus de son : on fige la barre, on atténue l'overlay (veille discrète)
        // et on garde le dernier morceau affiché.
        current.playing = false;
        current.lastTick = null;
        cardEl.classList.add('np-idle');
        if (!hasPlayed) showPlaceholder();
      }
    } catch (err) {
      console.error('Erreur Last.fm:', err);
    }
  }

  showPlaceholder();
  ensureRenderLoop();
  fetchNowPlaying();
  setInterval(fetchNowPlaying, REFRESH_INTERVAL);
});