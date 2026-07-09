/* ============================================================
   HELPERS COULEUR
   ============================================================ */
function normalizeHex(hex) {
  let c = (hex || '#000000').toString().replace('#', '').trim();
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (c.length === 8) c = c.slice(0, 6);   // #rrggbbaa -> on ignore l'alpha
  if (c.length !== 6 || /[^0-9a-fA-F]/.test(c)) c = '000000';
  return c;
}
function hexToRgb(hex) {
  const c = normalizeHex(hex);
  const n = parseInt(c, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const f = (x, y) => Math.round(x + (y - x) * t);
  const h = v => v.toString(16).padStart(2, '0');
  return '#' + h(f(A.r, B.r)) + h(f(A.g, B.g)) + h(f(A.b, B.b));
}
function lighten(hex, t) { return mixHex(hex, '#ffffff', t); }
function darken(hex, t) { return mixHex(hex, '#000000', t); }

/* ============================================================
   MARQUEE INTELLIGENT — jamais de coupe, jamais de micro
   ping-pong. Ordre des leviers, du moins visible au plus visible :
   Principe du "juste milieu" : on n'absorbe un débord QUE s'il est
   petit par rapport à la zone (<= ~9% de sa largeur, plancher 8px).
   En dessous : interlettrage (-0.30px max) puis légère réduction
   (-5% max) -> texte entier, statique, sans effet tassé.
   Au-delà : défilement direct à taille normale — on ne compresse pas
   un texte long pour le faire tenir, ça rendrait la zone bord à bord.
   1. tient                          -> statique centré
   2. petit débord (<= seuil)        -> absorbé invisiblement, statique
   3. vrai débord (> seuil)          -> défilement fluide, aligné à gauche.
   ============================================================ */
function createMarquee(containerEl, textEl, baseSizePx, speed, pauseMs) {
  return {
    containerEl, textEl,
    baseSize: baseSizePx || 14,
    maxTracking: 0.30,       // resserrage max de l'interlettrage (px)
    trackingStep: 0.05,
    minScale: 0.95,          // réduction de police max : -5%
    scaleStep: 0.01,
    fitEps: 2,               // marge (px) sous laquelle "ça tient"
    absorbRatio: 0.09,       // seuil d'absorption : 9% de la largeur de zone
    absorbFloor: 8,          //   ... avec un plancher de 8px
    speed: speed || 22,
    pauseMs: pauseMs || 1200,
    raf: null, offset: 0, overflow: 0,
    state: 'pausing-start', pauseUntil: 0, lastTime: null,

    setBaseSize(px) { this.baseSize = px; },

    measureOverflow() {
      return this.textEl.scrollWidth - this.containerEl.clientWidth;
    },

    reset() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.offset = 0;
      this.textEl.style.transform = 'translateX(0px)';
      this.textEl.style.fontSize = this.baseSize + 'px';
      this.textEl.style.letterSpacing = '0px';
      this.lastTime = null;
      this.state = 'pausing-start';
      requestAnimationFrame(() => {
        const overflow0 = this.measureOverflow();

        // Palier 1 : ça tient tel quel -> statique centré.
        if (overflow0 <= this.fitEps) {
          this.containerEl.classList.remove('np-scrolling');
          return;
        }

        // Palier 2 : petit débord uniquement (juste milieu). Le seuil est
        // proportionnel à la zone : un débord au-delà serait trop compressé
        // visuellement -> on préfère défiler.
        const absorbLimit = Math.max(this.absorbFloor, this.containerEl.clientWidth * this.absorbRatio);
        if (overflow0 <= absorbLimit) {
          // 2a. resserrage de l'interlettrage (invisible)
          for (let ls = this.trackingStep; ls <= this.maxTracking + 1e-9; ls += this.trackingStep) {
            this.textEl.style.letterSpacing = '-' + ls.toFixed(2) + 'px';
            if (this.measureOverflow() <= this.fitEps) {
              this.containerEl.classList.remove('np-scrolling');
              return;
            }
          }
          // 2b. en complément, très légère réduction de police
          for (let s = 1 - this.scaleStep; s >= this.minScale - 1e-9; s -= this.scaleStep) {
            this.textEl.style.fontSize = (this.baseSize * s).toFixed(2) + 'px';
            if (this.measureOverflow() <= this.fitEps) {
              this.containerEl.classList.remove('np-scrolling');
              return;
            }
          }
        }

        // Palier 3 : vrai débord -> taille/espacement normaux,
        // aligné à gauche + défilement ping-pong fluide.
        this.textEl.style.fontSize = this.baseSize + 'px';
        this.textEl.style.letterSpacing = '0px';
        this.overflow = this.measureOverflow();
        this.containerEl.classList.add('np-scrolling');
        this.pauseUntil = performance.now() + this.pauseMs;
        this.raf = requestAnimationFrame((t) => this.tick(t));
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
function createStardust(ambientLayer, burstLayer, colors) {
  const rand = (a, b) => a + Math.random() * (b - a);

  const AMB = colors && colors.ambient ? colors.ambient : '#cbb0ab';
  const BUR = colors && colors.burst ? colors.burst : '#d8beb8';
  const ambBody = lighten(AMB, 0.35);
  const burBody = lighten(BUR, 0.35);

  function sparkleSVG(size, blur, fill, glow) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 0 ' + blur + 'px ' + hexToRgba(glow, 0.95) + ')">'
      + '<path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill="' + fill + '"/></svg>';
  }

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
    s.style.background = ambBody;
    s.style.boxShadow = size > 1.9
      ? '0 0 4px ' + hexToRgba(AMB, 0.9) + ',0 0 8px ' + hexToRgba(AMB, 0.6)
      : '0 0 3px ' + hexToRgba(AMB, 0.85);
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
    w.innerHTML = sparkleSVG(size, 3, ambBody, AMB);
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

  function burstDot(dir) {
    const s = document.createElement('div');
    s.className = 'np-fx-dot';
    const size = rand(1, 2.8);
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = rand(2, 98) + '%';
    s.style.top = rand(6, 94) + '%';
    s.style.background = burBody;
    s.style.boxShadow = size > 2
      ? '0 0 5px ' + hexToRgba(BUR, 0.95) + ',0 0 10px ' + hexToRgba(BUR, 0.7)
      : '0 0 3px ' + hexToRgba(BUR, 0.9);
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
    w.innerHTML = sparkleSVG(size, 4, burBody, BUR);
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
  const CARD_WIDTH   = int(fieldData.cardWidth, 400);
  const CARD_GAP     = int(fieldData.cardGap, 8);
  const TITLE_ZONE   = int(fieldData.titleZoneWidth, 155);
  const ARTIST_ZONE  = int(fieldData.artistZoneWidth, 100);
  let CARD_BG_COLOR = fieldData.cardBgColor || '#5e3f3b';
  let CARD_BG_OPACITY = num(fieldData.cardBgOpacity, 0.9);
  const BORDER_COLOR = fieldData.borderColor || '#2a1c1b';
  const BORDER_OPACITY = num(fieldData.borderOpacity, 0.5);
  const BORDER_WIDTH = num(fieldData.borderWidth, 0);
  const RADIUS = int(fieldData.cardRadius, 13);
  const SHADOW_OPACITY = num(fieldData.shadowOpacity, 0.28);
  const SHADOW_COLOR = fieldData.shadowColor || '#000000';
  const SHADOW_BLUR = num(fieldData.shadowBlur, 16);
  const PLAY_COLOR = fieldData.playColor || '#a88b86';
  const ICON_SIZE = num(fieldData.iconSize, 18);
  const ICON_GLOW = num(fieldData.iconGlow, 0);
  let TITLE_COLOR = fieldData.titleColor || '#ac8a86';
  let ARTIST_COLOR = fieldData.artistColor || '#ac8a86';
  const TEXT_STROKE = fieldData.textStrokeColor || '#34211f';
  const DIVIDER_COLOR = fieldData.dividerColor || '#a88b86';
  const TITLE_SIZE = num(fieldData.titleSize, 14);
  const ARTIST_SIZE = num(fieldData.artistSize, 12);
  const TITLE_STROKE_W = num(fieldData.titleStrokeWidth, 0);
  const ARTIST_STROKE_W = num(fieldData.artistStrokeWidth, 0);
  const PLACEHOLDER_TITLE = fieldData.placeholderTitle || 'Aucune musique';
  const PLACEHOLDER_ARTIST = fieldData.placeholderArtist || '—';

  // ===== PRESETS (issus du nuancier demo-couleurs) =====
  // Fond : écrase couleur + opacité si un preset est choisi.
  // "custom" (Manuel) => les champs individuels font foi.
  const BG_PRESETS = {
    a1: { hex: '#5e3f3b', op: 0.90 },   // brun actuel (référence)
    a2: { hex: '#6b4a44', op: 0.90 },   // brun plus léger
    a3: { hex: '#7a5750', op: 0.90 },   // brun clair chaud
    a4: { hex: '#62434f', op: 0.90 },   // brun-mauve
    a5: { hex: '#6d4a5c', op: 0.90 },   // mauve
    a6: { hex: '#7a5666', op: 0.90 },   // mauve clair
    b1: { hex: '#6b4a44', op: 0.85 },
    b2: { hex: '#6b4a44', op: 0.70 },
    b3: { hex: '#6b4a44', op: 0.55 },
    b4: { hex: '#6d4a5c', op: 0.85 },
    b5: { hex: '#6d4a5c', op: 0.70 },
    b6: { hex: '#6d4a5c', op: 0.55 },
  };
  // Texte : écrase couleurs titre + artiste si un preset est choisi.
  const TEXT_PRESETS = {
    t1: { title: '#ac8a86', artist: '#ac8a86' },   // taupe rosé uni
    t2: { title: '#ac8a86', artist: '#927370' },   // duo référence (artiste éteint)
    t3: { title: '#c9a9a3', artist: '#ac8a86' },   // duo clair (titre relevé)
    t4: { title: '#e6d0ca', artist: '#b89792' },   // rose taupe lumineux
  };

  const bgPreset = BG_PRESETS[fieldData.presetBg];
  if (bgPreset) {
    CARD_BG_COLOR = bgPreset.hex;
    CARD_BG_OPACITY = bgPreset.op;
  }
  const textPreset = TEXT_PRESETS[fieldData.presetText];
  if (textPreset) {
    TITLE_COLOR = textPreset.title;
    ARTIST_COLOR = textPreset.artist;
  }

  // ===== Étoile centrale =====
  const STAR_COLOR         = fieldData.starColor || '#bd9791';
  const STAR_GLOW_COLOR    = fieldData.starGlowColor || '#8f6b67';
  const STAR_BORDER_COLOR  = fieldData.starBorderColor || '#6e514e';
  const STAR_SIZE          = num(fieldData.starSize, 11);
  const STAR_GLOW_INTENSITY = num(fieldData.starGlowIntensity, 0.45);
  const STAR_PULSE_SCALE   = num(fieldData.starPulseScale, 1.12);
  const STAR_PULSE_SPEED   = num(fieldData.starPulseSpeed, 4.5);

  // ===== Effets d'étoiles (couleur seule, ambiantes / burst séparés) =====
  const AMBIENT_STAR_COLOR = fieldData.ambientStarColor || '#cbb0ab';
  const BURST_STAR_COLOR   = fieldData.burstStarColor || '#d8beb8';

  // ===== Barre de progression + halo de l'icône (paramètres séparés) =====
  const PROGRESS_TRACK_COLOR   = fieldData.progressTrackColor || '#2a1c1b';
  const PROGRESS_TRACK_OPACITY = num(fieldData.progressTrackOpacity, 0.35);
  const PROGRESS_FILL_COLOR = fieldData.progressFillColor || '#b0908b';
  const PROGRESS_TIP_COLOR  = fieldData.progressTipColor || '#c9a9a3';
  const PROGRESS_TIP_SIZE   = num(fieldData.progressTipSize, 4.5);
  const PROGRESS_WIDTH      = num(fieldData.progressBarWidth, 36);
  const ICON_HALO_COLOR     = fieldData.iconHaloColor || '#a88b86';

  const root = document.documentElement.style;
  root.setProperty('--np-card-width', CARD_WIDTH + 'px');
  root.setProperty('--np-gap', CARD_GAP + 'px');
  root.setProperty('--np-title-zone', TITLE_ZONE + 'px');
  root.setProperty('--np-artist-zone', ARTIST_ZONE + 'px');
  root.setProperty('--np-card-bg', hexToRgba(CARD_BG_COLOR, CARD_BG_OPACITY));
  root.setProperty('--np-border-color', hexToRgba(BORDER_COLOR, BORDER_OPACITY));
  root.setProperty('--np-border-width', BORDER_WIDTH + 'px');
  root.setProperty('--np-radius', RADIUS + 'px');
  // Ombre portée : opacité 0 = aucune ; le fin reflet interne (sheen) est conservé.
  const sheen = 'inset 0 1px 0 rgba(255, 240, 236, 0.06)';
  root.setProperty('--np-card-shadow', SHADOW_OPACITY > 0
    ? '0 4px ' + SHADOW_BLUR + 'px ' + hexToRgba(SHADOW_COLOR, SHADOW_OPACITY) + ', ' + sheen
    : sheen);
  root.setProperty('--np-play-color', PLAY_COLOR);
  root.setProperty('--np-icon-size', ICON_SIZE + 'px');
  root.setProperty('--np-icon-glow', ICON_GLOW + 'px');
  root.setProperty('--np-title-color', TITLE_COLOR);
  root.setProperty('--np-artist-color', ARTIST_COLOR);
  root.setProperty('--np-divider-color', DIVIDER_COLOR);

  // --- Étoile centrale : dégradé + halos construits à partir des couleurs ---
  function buildStarGradient(tint) {
    const core = lighten(tint, 0.55);  // cœur clair mais PAS blanc (rendu doux)
    const mid  = lighten(tint, 0.28);
    const edge = tint;
    const rim  = darken(tint, 0.12);
    return `radial-gradient(circle, ${core} 0%, ${mid} 35%, ${edge} 70%, ${rim} 100%)`;
  }
  function buildStarGlow(glowHex, k) {
    const kk = Math.max(0, k);
    return `0 0 ${(10 * kk).toFixed(1)}px ${hexToRgba(glowHex, 0.9)}, `
         + `0 0 ${(18 * kk).toFixed(1)}px ${hexToRgba(glowHex, 0.7)}, `
         + `0 0 ${(28 * kk).toFixed(1)}px ${hexToRgba(glowHex, 0.4)}`;
  }
  function buildStarOuter(glowHex) {
    return `radial-gradient(circle, ${hexToRgba(glowHex, 0.7)} 0%, ${hexToRgba(glowHex, 0.18)} 25%, transparent 70%)`;
  }

  root.setProperty('--np-star-size', STAR_SIZE + 'px');
  root.setProperty('--np-star-border-color', STAR_BORDER_COLOR);
  root.setProperty('--np-star-gradient', buildStarGradient(STAR_COLOR));
  root.setProperty('--np-star-glow', buildStarGlow(STAR_GLOW_COLOR, STAR_GLOW_INTENSITY));
  root.setProperty('--np-star-outer', buildStarOuter(STAR_GLOW_COLOR));
  root.setProperty('--np-star-pulse-speed', STAR_PULSE_SPEED + 's');
  root.setProperty('--np-star-pulse-scale', STAR_PULSE_SCALE);

  // --- Halo derrière l'icône play ---
  root.setProperty('--np-icon-glow-color', hexToRgba(ICON_HALO_COLOR, 0.95));

  // --- Barre de progression : rainure (vide) + remplissage + bout ---
  root.setProperty('--np-progress-track', hexToRgba(PROGRESS_TRACK_COLOR, PROGRESS_TRACK_OPACITY));
  root.setProperty('--np-progress-fill',
    `linear-gradient(90deg, ${PROGRESS_FILL_COLOR}, ${lighten(PROGRESS_FILL_COLOR, 0.5)}, ${PROGRESS_FILL_COLOR})`);
  root.setProperty('--np-progress-width', PROGRESS_WIDTH + 'px');
  root.setProperty('--np-tip-size', PROGRESS_TIP_SIZE + 'px');
  root.setProperty('--np-tip-color', PROGRESS_TIP_COLOR);
  root.setProperty('--np-tip-glow',
    `0 0 6px ${hexToRgba(PROGRESS_TIP_COLOR, 0.95)}, 0 0 12px ${hexToRgba(PROGRESS_TIP_COLOR, 0.6)}`);

  // Contour "pro" par ombres multiples réparties sur un ANNEAU.
  function buildOutline(width, color, dropAlpha) {
    const w = Math.max(0, width);
    if (w < 0.05) return `0 1px 1.5px rgba(0,0,0,${dropAlpha})`;

    const ring = (radius, angleOffset) => {
      const r = radius;
      const steps = Math.min(48, Math.max(12, Math.ceil((2 * Math.PI * r) / 0.45)));
      const out = [];
      for (let i = 0; i < steps; i++) {
        const a = (2 * Math.PI * i) / steps + angleOffset;
        const x = (Math.cos(a) * r).toFixed(2);
        const y = (Math.sin(a) * r).toFixed(2);
        out.push(`${x}px ${y}px 0 ${color}`);
      }
      return out;
    };

    let parts = ring(w, 0);
    if (w > 1.2) {
      const steps = Math.min(48, Math.max(12, Math.ceil((2 * Math.PI * w) / 0.45)));
      parts = parts.concat(ring(w * 0.55, Math.PI / steps));
    }

    const relief = Math.min(1, w / 0.8);
    parts.push(`0 1px 1.5px rgba(0,0,0,${(dropAlpha * relief).toFixed(3)})`);
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

  const titleMarquee = createMarquee(document.querySelector('.np-title-wrap'), titleEl, TITLE_SIZE);
  const artistMarquee = createMarquee(document.querySelector('.np-artist-wrap'), artistEl, ARTIST_SIZE);
  const stardust = createStardust(ambientLayer, burstLayer, {
    ambient: AMBIENT_STAR_COLOR,
    burst: BURST_STAR_COLOR,
  });

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
  let visShown = false;
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
    if (!ENABLE_DISAPPEAR) return;
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
      appear();
      return;
    }

    st.isPlaying = false;
    setIdle(true);

    if (status === 200 && data && data.item) {
      const item = data.item;
      st.durationMs = item.duration_ms || 0;
      st.anchorMs = (typeof data.progress_ms === 'number') ? data.progress_ms : st.anchorMs;
      st.anchorAt = Date.now();
      renderTrack(item.name, extractArtist(item));
      ensureRenderLoop();
    } else {
      if (SHOW_LAST_TRACK && !st.hasContent) {
        const ok = await fetchLastPlayed();
        if (!ok) showPlaceholder();
      } else if (!st.hasContent) {
        showPlaceholder();
      }
    }

    if (visShown) {
      scheduleHide();
    } else if (!ENABLE_DISAPPEAR) {
      appear();
    }
  }

  // ===== Mode démo (sans Spotify) =====
  function startDemo() {
    st.isPlaying = true;
    st.durationMs = 22000;
    st.anchorMs = 0;
    st.anchorAt = Date.now();
    renderTrack('Blinding Lights', 'The Weeknds');
    ensureRenderLoop();
    setIdle(false);
    appear();

    setInterval(() => {
      if (Date.now() - st.anchorAt > st.durationMs) st.anchorAt = Date.now();
    }, 400);

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
          }, HIDE_DELAY > 6000 ? 4500 : HIDE_DELAY);
        }, 11000);
      };
      cycle();
    }
  }

  // ===== Démarrage =====
  if (DEMO_MODE) {
    startDemo();
    return;
  }

  if (!ENABLE_DISAPPEAR && !ENABLE_APPEAR) {
    cardEl.classList.remove('np-hidden');
    visShown = true;
    if (ENABLE_AMBIENT) stardust.startAmbient();
  }
  ensureRenderLoop();
  poll();
  setInterval(poll, REFRESH_INTERVAL);
});