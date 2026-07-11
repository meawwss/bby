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
   MARQUEE DE BLOC — le bloc [titre ★ artiste] est mesuré et
   déplacé comme UNE SEULE unité. Même intelligence 3 paliers :
   1. le bloc tient                  -> statique (ancré à gauche)
   2. petit débord (<= ~9% de zone,  -> absorbé invisiblement :
      plancher 8px)                     interlettrage (-0.30px max)
                                        puis micro-réduction (-5% max)
                                        appliqués aux DEUX textes
                                        ensemble (typo uniforme)
   3. vrai débord                    -> ping-pong fluide du bloc
                                        entier, pause longue (~4s),
                                        vitesse douce.
   ============================================================ */
function createBlockMarquee(zoneEl, blockEl, textEls, baseSizePx, speed, pauseMs) {
  return {
    zoneEl, blockEl, textEls,
    baseSize: baseSizePx || 12,
    maxTracking: 0.30,       // resserrage max de l'interlettrage (px)
    trackingStep: 0.05,
    minScale: 0.95,          // réduction de police max : -5%
    scaleStep: 0.01,
    /* fitEps = 0 : scrollWidth/clientWidth sont des ENTIERS, et toute
       tolérance ici est un débord ACCEPTÉ qui finit croqué par le clip
       (overflow:hidden) sur la dernière lettre. L'ancien 2 servait de
       garde-fou contre le bruit de mesure, mais coûtait jusqu'à 2px de
       glyphe. À 0, un débord mesuré de 1-2px part en absorption
       invisible (palier 2) au lieu d'être mangé — aucun inconvénient. */
    fitEps: 0,
    absorbRatio: 0.09,       // seuil d'absorption : 9% de la largeur de zone
    absorbFloor: 8,          //   ... avec un plancher de 8px
    speed: speed || 19,
    pauseMs: pauseMs || 4000,
    raf: null, offset: 0, overflow: 0,
    state: 'pausing-start', pauseUntil: 0, lastTime: null,

    setBaseSize(px) { this.baseSize = px; },

    measureOverflow() {
      return this.blockEl.scrollWidth - this.zoneEl.clientWidth;
    },

    applySize(px) {
      this.textEls.forEach(el => { el.style.fontSize = px.toFixed(2) + 'px'; });
    },

    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
    },

    reset() {
      this.stop();
      this.offset = 0;
      this.blockEl.style.marginLeft = '0px';
      this.blockEl.style.letterSpacing = '0px';
      this.applySize(this.baseSize);
      this.lastTime = null;
      this.state = 'pausing-start';
      requestAnimationFrame(() => {
        const overflow0 = this.measureOverflow();

        // Palier 1 : le bloc tient tel quel -> statique.
        if (overflow0 <= this.fitEps) {
          this.zoneEl.classList.remove('np-scrolling');
          if (this.painter) this.painter.exitScroll();
          return;
        }

        // Palier 2 : petit débord uniquement (juste milieu).
        const absorbLimit = Math.max(this.absorbFloor, this.zoneEl.clientWidth * this.absorbRatio);
        if (overflow0 <= absorbLimit) {
          // 2a. resserrage de l'interlettrage (invisible, appliqué au bloc,
          //     donc hérité par les deux textes -> reste uniforme)
          for (let ls = this.trackingStep; ls <= this.maxTracking + 1e-9; ls += this.trackingStep) {
            this.blockEl.style.letterSpacing = '-' + ls.toFixed(2) + 'px';
            if (this.measureOverflow() <= this.fitEps) {
              this.zoneEl.classList.remove('np-scrolling');
              if (this.painter) this.painter.exitScroll();
              return;
            }
          }
          // 2b. en complément, très légère réduction (les DEUX textes ensemble)
          for (let s = 1 - this.scaleStep; s >= this.minScale - 1e-9; s -= this.scaleStep) {
            this.applySize(this.baseSize * s);
            if (this.measureOverflow() <= this.fitEps) {
              this.zoneEl.classList.remove('np-scrolling');
              if (this.painter) this.painter.exitScroll();
              return;
            }
          }
        }

        // Palier 3 : vrai débord -> taille/espacement normaux,
        // ping-pong fluide du bloc entier avec fondu de bords peint
        // dans les glyphes (voir painter, aucune couche GPU).
        this.applySize(this.baseSize);
        this.blockEl.style.letterSpacing = '0px';
        this.overflow = this.measureOverflow();
        this.zoneEl.classList.add('np-scrolling');
        if (this.painter) this.painter.enterScroll(this.overflow);
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
        const px = Math.round(this.offset);
        this.blockEl.style.marginLeft = '-' + px + 'px';
        if (this.painter) this.painter.frame(px);
      } else if (this.state === 'scrolling-right') {
        this.offset -= this.speed * dt;
        if (this.offset <= 0) {
          this.offset = 0;
          this.state = 'pausing-start';
          this.pauseUntil = time + this.pauseMs;
        }
        const px = Math.round(this.offset);
        this.blockEl.style.marginLeft = '-' + px + 'px';
        if (this.painter) this.painter.frame(px);
      }
      this.raf = requestAnimationFrame((t) => this.tick(t));
    },
  };
}

/* ============================================================
   SYSTÈME D'ÉTOILES (ambiance + apparition + disparition)

   FIX ANTI-FLOU : les étoiles AMBIANTES ne passent PLUS par
   element.animate() (WAAPI). Une animation WAAPI est composée
   sur le GPU : le navigateur promeut la particule en couche,
   puis tout ce qui la chevauche (fond, textes, icônes) pour
   préserver l'ordre d'empilement. Ces couches sont rasterisées
   en bitmap puis remises à l'échelle par le transform que
   StreamElements/OBS applique au widget -> TOUT devient flou
   pendant l'animation. À la place, un ticker rAF écrit
   transform/opacity en styles inline à chaque frame (thread
   principal) : rendu identique, AUCUNE couche créée, aucun flou.

   Les BURSTS (apparition/disparition) restent en WAAPI : le
   léger flou pendant les fondus de la carte est accepté, et le
   compositeur encaisse mieux les 47 particules simultanées.
   ============================================================ */

/* --- Ticker main-thread partagé par toutes les particules ambiantes --- */
const fxTicker = (() => {
  const items = [];
  let raf = null;
  function frame(now) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const p = (now - it.start) / it.dur;
      if (p < 0) continue;                       // délai pas encore écoulé
      if (p >= 1) { it.el.remove(); items.splice(i, 1); continue; }
      it.step(p);
    }
    raf = items.length ? requestAnimationFrame(frame) : null;
  }
  return {
    add(el, dur, delay, step) {
      el.style.opacity = '0';                    // invisible pendant le délai
      items.push({ el, dur, start: performance.now() + delay, step });
      if (!raf) raf = requestAnimationFrame(frame);
    },
    clear() {
      for (let i = items.length - 1; i >= 0; i--) { items[i].el.remove(); }
      items.length = 0;
    },
  };
})();

const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;

/* Animation main-thread générique : appelle step(p) à chaque frame.
   Si step renvoie true, l'animation est annulée. done() à la fin. */
function animateStyles(dur, step, done) {
  const start = performance.now();
  function fr(now) {
    const p = Math.min(1, (now - start) / dur);
    if (step(p) === true) return;   // annulée
    if (p < 1) requestAnimationFrame(fr);
    else if (done) done();
  }
  requestAnimationFrame(fr);
}

/* Interpolation 3 points (a -> b au point m, puis b -> c), avec easing
   appliqué par segment — reproduit les keyframes WAAPI d'origine. */
function tri(p, m, a, b, c) {
  if (p < m) { const t = easeInOut(p / m); return a + (b - a) * t; }
  const t = easeInOut((p - m) / (1 - m));
  return b + (c - b) * t;
}

function createStardust(ambientLayer, burstLayer, colors) {
  const rand = (a, b) => a + Math.random() * (b - a);

  const AMB = colors && colors.ambient ? colors.ambient : '#d2b3de';
  const BUR = colors && colors.burst ? colors.burst : '#e3d3ec';
  const ambBody = lighten(AMB, 0.35);
  const burBody = lighten(BUR, 0.35);

  function sparkleSVG(size, blur, fill, glow) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 0 ' + blur + 'px ' + hexToRgba(glow, 0.95) + ')">'
      + '<path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill="' + fill + '"/></svg>';
  }

  let ambientRunning = false;
  let ambientTimer = null;

  /* --- Ambiantes : visuel d'ORIGINE (halos, tailles, dérives, partout
         sur la pilule), animées sur le thread principal. --- */
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
    ambientLayer.appendChild(s);
    fxTicker.add(s, dur, delay, (p) => {
      const sc = tri(p, 0.4, 0.25, 1, 0.4);
      const ox = tri(p, 0.4, 0, dx * 0.4, dx);
      const oy = tri(p, 0.4, 0, dy * 0.4, dy);
      s.style.transform = 'translate(' + ox.toFixed(2) + 'px,' + oy.toFixed(2) + 'px) scale(' + sc.toFixed(3) + ')';
      s.style.opacity = tri(p, 0.4, 0, peak, 0).toFixed(3);
    });
  }

  function ambientSpk() {
    const w = document.createElement('div');
    w.className = 'np-fx-spk';
    const size = rand(6, 10);
    w.style.left = rand(5, 95) + '%';
    w.style.top = rand(12, 88) + '%';
    w.innerHTML = sparkleSVG(size, 3, ambBody, AMB);
    const peak = rand(0.5, 0.8), dur = rand(1600, 2300), delay = rand(0, 600), rot = rand(-40, 40);
    ambientLayer.appendChild(w);
    fxTicker.add(w, dur, delay, (p) => {
      const sc = tri(p, 0.4, 0, 1, 0.4);
      const rz = tri(p, 0.4, 0, rot * 0.5, rot);
      w.style.transform = 'scale(' + sc.toFixed(3) + ') rotate(' + rz.toFixed(1) + 'deg)';
      w.style.opacity = tri(p, 0.4, 0, peak, 0).toFixed(3);
    });
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
  const CARD_HEIGHT  = int(fieldData.cardHeight, 38);
  const SIDE_MARGIN  = int(fieldData.sideMargin, 32);
  const ICON_GAP     = int(fieldData.iconTextGap, 13);
  const BLOCK_GAP    = int(fieldData.blockGap, 12);
  const TEXT_BAR_GAP = int(fieldData.textBarGap, 12);
  let CARD_BG_COLOR = fieldData.cardBgColor || '#16151e';
  let CARD_BG_OPACITY = num(fieldData.cardBgOpacity, 0.85);
  const BORDER_COLOR = fieldData.borderColor || '#373753';
  const BORDER_OPACITY = num(fieldData.borderOpacity, 0.5);
  const BORDER_WIDTH = num(fieldData.borderWidth, 0);
  const RADIUS = int(fieldData.cardRadius, 19);
  const SHADOW_OPACITY = num(fieldData.shadowOpacity, 0.28);
  const SHADOW_COLOR = fieldData.shadowColor || '#000000';
  const SHADOW_BLUR = num(fieldData.shadowBlur, 16);
  const PLAY_COLOR = fieldData.playColor || '#f7e9a1';
  const ICON_SIZE = num(fieldData.iconSize, 11);
  const ICON_GLOW = num(fieldData.iconGlow, 0);
  let TITLE_COLOR = fieldData.titleColor || '#e9e5b1';
  let ARTIST_COLOR = fieldData.artistColor || '#d6d5e6';
  const TEXT_STROKE = fieldData.textStrokeColor || '#0e0d14';
  const TEXT_SIZE = num(fieldData.textSize, 12);
  const TITLE_STROKE_W = num(fieldData.titleStrokeWidth, 0);
  const ARTIST_STROKE_W = num(fieldData.artistStrokeWidth, 0);
  const PLACEHOLDER_TITLE = fieldData.placeholderTitle || 'Aucune musique';
  const PLACEHOLDER_ARTIST = fieldData.placeholderArtist || '—';

  // ===== Police (Google Fonts, chargée dynamiquement) =====
  const FONT = (fieldData.fontFamily || 'Quicksand').toString();
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family='
    + encodeURIComponent(FONT).replace(/%20/g, '+')
    + ':wght@400;500;600;700&display=swap';
  document.head.appendChild(fontLink);

  // ===== PRESETS — palette "nuit lavande" =====
  // Fond : écrase couleur + opacité si un preset est choisi.
  // "custom" (Manuel) => les champs individuels font foi.
  const BG_PRESETS = {
    n1: { hex: '#16151e', op: 0.85 },   // nuit référence
    n2: { hex: '#16151e', op: 0.70 },   // nuit plus aérienne
    n3: { hex: '#16151e', op: 1.00 },   // nuit pleine (opaque)
    n4: { hex: '#1b1a26', op: 0.85 },   // nuit bleutée
    n5: { hex: '#221c2b', op: 0.85 },   // nuit mauve
    n6: { hex: '#0f0e15', op: 0.90 },   // encre profonde
  };
  // Texte : écrase couleurs titre + artiste si un preset est choisi.
  const TEXT_PRESETS = {
    t1: { title: '#e9e5b1', artist: '#d6d5e6' },   // référence : jaune pâle / lavande
    t2: { title: '#d6d5e6', artist: '#a9a8c4' },   // tout lavande (artiste éteint)
    t3: { title: '#f4f0c8', artist: '#e2e1f2' },   // duo lumineux
    t4: { title: '#e5cdee', artist: '#d6d5e6' },   // mauve doux / lavande
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
  const STAR_COLOR         = fieldData.starColor || '#d2b3de';
  const STAR_GLOW_COLOR    = fieldData.starGlowColor || '#b997c6';
  const STAR_BORDER_COLOR  = fieldData.starBorderColor || '#9d82a8';
  const STAR_SIZE          = num(fieldData.starSize, 9);
  const STAR_GLOW_INTENSITY = num(fieldData.starGlowIntensity, 0.4);
  const STAR_PULSE_SCALE   = num(fieldData.starPulseScale, 1.12);
  const STAR_PULSE_SPEED   = num(fieldData.starPulseSpeed, 4.5);

  // ===== Effets d'étoiles (couleur seule, ambiantes / burst séparés) =====
  const AMBIENT_STAR_COLOR = fieldData.ambientStarColor || '#d2b3de';
  const BURST_STAR_COLOR   = fieldData.burstStarColor || '#e3d3ec';

  // ===== Barre de progression + halo de l'icône =====
  const DIVIDER_COLOR          = fieldData.dividerColor || '#bca3f7';
  const PROGRESS_TRACK_COLOR   = fieldData.progressTrackColor || '#373753';
  const PROGRESS_TRACK_OPACITY = num(fieldData.progressTrackOpacity, 1);
  const PROGRESS_FILL_COLOR = fieldData.progressFillColor || '#bca3f7';
  const PROGRESS_STYLE      = fieldData.progressStyle || 'flat';
  const PROGRESS_WIDTH      = num(fieldData.progressBarWidth, 80);
  const PROGRESS_HEIGHT     = num(fieldData.progressBarHeight, 8);
  const ICON_HALO_COLOR     = fieldData.iconHaloColor || '#f7e9a1';

  // ===== Marquee =====
  const SCROLL_SPEED = num(fieldData.scrollSpeed, 19);
  const SCROLL_PAUSE = num(fieldData.scrollPauseSeconds, 4) * 1000;

  const root = document.documentElement.style;
  root.setProperty('--np-font', '"' + FONT + '"');
  root.setProperty('--np-card-width', CARD_WIDTH + 'px');
  root.setProperty('--np-card-height', CARD_HEIGHT + 'px');
  root.setProperty('--np-side-margin', SIDE_MARGIN + 'px');
  root.setProperty('--np-icon-gap', ICON_GAP + 'px');
  root.setProperty('--np-block-gap', BLOCK_GAP + 'px');
  root.setProperty('--np-text-bar-gap', TEXT_BAR_GAP + 'px');
  root.setProperty('--np-card-bg', hexToRgba(CARD_BG_COLOR, CARD_BG_OPACITY));
  root.setProperty('--np-border-color', hexToRgba(BORDER_COLOR, BORDER_OPACITY));
  root.setProperty('--np-border-width', BORDER_WIDTH + 'px');
  root.setProperty('--np-radius', RADIUS + 'px');
  // Ombre portée : opacité 0 = aucune ; le fin reflet interne (sheen) est conservé.
  const sheen = 'inset 0 1px 0 rgba(236, 236, 255, 0.05)';
  root.setProperty('--np-card-shadow', SHADOW_OPACITY > 0
    ? '0 4px ' + SHADOW_BLUR + 'px ' + hexToRgba(SHADOW_COLOR, SHADOW_OPACITY) + ', ' + sheen
    : sheen);
  root.setProperty('--np-play-color', PLAY_COLOR);
  root.setProperty('--np-icon-size', ICON_SIZE + 'px');
  root.setProperty('--np-icon-glow', ICON_GLOW + 'px');
  root.setProperty('--np-title-color', TITLE_COLOR);
  root.setProperty('--np-artist-color', ARTIST_COLOR);
  root.setProperty('--np-text-size', TEXT_SIZE + 'px');

  // --- Étoile centrale : dégradé + halos construits à partir des couleurs ---
  // Rendu volontairement fondu : cœur peu éclairci (jamais blanc) et halos
  // à faible densité pour rester raccord avec le fond nuit.
  function buildStarGradient(tint) {
    const core = lighten(tint, 0.32);
    const mid  = lighten(tint, 0.15);
    const edge = tint;
    const rim  = darken(tint, 0.15);
    return `radial-gradient(circle, ${core} 0%, ${mid} 35%, ${edge} 70%, ${rim} 100%)`;
  }
  function buildStarGlow(glowHex, k) {
    const kk = Math.max(0, k);
    return `0 0 ${(10 * kk).toFixed(1)}px ${hexToRgba(glowHex, 0.55)}, `
         + `0 0 ${(18 * kk).toFixed(1)}px ${hexToRgba(glowHex, 0.32)}, `
         + `0 0 ${(28 * kk).toFixed(1)}px ${hexToRgba(glowHex, 0.16)}`;
  }
  function buildStarOuter(glowHex) {
    return `radial-gradient(circle, ${hexToRgba(glowHex, 0.4)} 0%, ${hexToRgba(glowHex, 0.1)} 25%, transparent 70%)`;
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

  // --- Séparateur 3 points ---
  root.setProperty('--np-divider-color', DIVIDER_COLOR);

  // --- Barre de progression : rainure + remplissage plat (ou dégradé doux) ---
  root.setProperty('--np-progress-track', hexToRgba(PROGRESS_TRACK_COLOR, PROGRESS_TRACK_OPACITY));
  root.setProperty('--np-progress-fill', PROGRESS_STYLE === 'gradient'
    ? `linear-gradient(90deg, ${PROGRESS_FILL_COLOR}, ${lighten(PROGRESS_FILL_COLOR, 0.3)}, ${PROGRESS_FILL_COLOR})`
    : PROGRESS_FILL_COLOR);
  root.setProperty('--np-progress-width', PROGRESS_WIDTH + 'px');
  root.setProperty('--np-progress-height', PROGRESS_HEIGHT + 'px');
  // Pointe biseautée : profondeur = moitié de la hauteur -> deux pans à ~45°
  root.setProperty('--np-tip-bevel', (PROGRESS_HEIGHT / 2).toFixed(1) + 'px');

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

  const cardEl = document.getElementById('now-playing-card');
  const titleEl = document.getElementById('np-title');
  const artistEl = document.getElementById('np-artist');
  const blockEl = document.getElementById('np-track-block');
  const trackZoneEl = document.getElementById('np-track-zone');
  const starSepEl = document.querySelector('.np-star-sep');
  const progressBarEl = document.getElementById('np-progress-bar');
  const ambientLayer = document.getElementById('np-fx-ambient');
  const burstLayer = document.getElementById('np-fx-burst');

  const blockMarquee = createBlockMarquee(
    trackZoneEl, blockEl, [titleEl, artistEl], TEXT_SIZE, SCROLL_SPEED, SCROLL_PAUSE
  );

  /* ===== PAINTER : fondu de bords NET pendant le défilement ============
     Recrée le fondu des bords SANS mask-image (un mask force la zone
     dans une surface composée -> rasterisation -> texte flou). Même
     principe que le fondu du swap : on module l'ALPHA DE LA PEINTURE
     des glyphes, jamais une couche. Ici via background-clip:text : un
     dégradé d'alpha aux couleurs du titre/artiste (AUCUN paramètre en
     plus), dimensionné sur la ZONE et recalé à chaque frame par
     background-position pendant que le bloc défile.

     Fondus DYNAMIQUES (fix du bug de butée) : leur largeur est
     min(FADE, distance restante) -> ils rétrécissent CONTINÛMENT
     jusqu'à 0 à l'approche des butées. La fin du texte n'est jamais
     mordue, et pas d'effet de "pop" comme avec un basculement binaire.

     L'étoile (sa propre micro-couche, cf. pulsation) suit le fondu via
     son opacité selon sa position dans les bandes. Les text-shadow sont
     coupées en mode défilement : color:transparent + background-clip
     laisseraient sinon l'ombre dessiner la silhouette des glyphes
     estompés (texte fantôme). fadeA (le fondu global du swap) est
     multiplié partout -> les deux fondus cohabitent sans conflit.
     Coût par frame : 5 écritures de style sur des éléments déjà
     repeints par le défilement lui-même. ==== */
  const painter = {
    FADE: 12,           // largeur max du fondu de bord (px)
    fadeA: 1,           // alpha global du bloc (piloté par le swap)
    scrolling: false,
    zoneW: 0, overflow: 0, offset: 0,
    pos: { t: 0, a: 0, s: 0 },   // positions dans le bloc (layout px)

    // Positions cachées au passage en défilement (layout px, insensibles
    // au scale SE/OBS contrairement à getBoundingClientRect).
    measure() {
      const b = blockEl.offsetLeft;
      this.pos.t = titleEl.offsetLeft - b;
      this.pos.a = artistEl.offsetLeft - b;
      this.pos.s = starSepEl.offsetLeft - b + starSepEl.offsetWidth / 2;
      this.zoneW = trackZoneEl.clientWidth;
    },

    enterScroll(overflow) {
      this.scrolling = true;
      this.overflow = overflow;
      this.measure();
      for (const el of [titleEl, artistEl]) {
        el.style.color = 'transparent';
        el.style.textShadow = 'none';
        el.style.webkitBackgroundClip = 'text';
        el.style.backgroundClip = 'text';
        el.style.backgroundRepeat = 'no-repeat';
        el.style.backgroundSize = this.zoneW + 'px 100%';
      }
      this.frame(0);
    },

    exitScroll() {
      this.scrolling = false;
      for (const el of [titleEl, artistEl]) {
        el.style.backgroundImage = '';
        el.style.backgroundPosition = '';
        el.style.backgroundRepeat = '';
        el.style.backgroundSize = '';
        el.style.backgroundClip = '';
        el.style.webkitBackgroundClip = '';
      }
      this.applyStatic();
    },

    // Peinture statique (paliers 1-2) : couleurs pleines modulées par fadeA.
    applyStatic() {
      const a = this.fadeA;
      if (a >= 1) {
        titleEl.style.color = '';       // retour aux variables CSS
        artistEl.style.color = '';
        titleEl.style.textShadow = '';
        artistEl.style.textShadow = '';
        starSepEl.style.opacity = '';
      } else {
        titleEl.style.color = hexToRgba(TITLE_COLOR, a);
        artistEl.style.color = hexToRgba(ARTIST_COLOR, a);
        titleEl.style.textShadow = 'none';   // sinon silhouette fantôme
        artistEl.style.textShadow = 'none';
        starSepEl.style.opacity = a.toFixed(3);
      }
    },

    // Peinture en défilement : appelée par le marquee avec le MÊME pixel
    // arrondi que le margin-left -> dégradés et texte toujours alignés.
    frame(offsetPx) {
      this.offset = offsetPx;
      const zw = this.zoneW;
      const fadeL = Math.max(0, Math.min(this.FADE, this.offset));
      const fadeR = Math.max(0, Math.min(this.FADE, this.overflow - this.offset));
      this.grad(titleEl, TITLE_COLOR, this.pos.t, fadeL, fadeR, zw);
      this.grad(artistEl, ARTIST_COLOR, this.pos.a, fadeL, fadeR, zw);
      // Étoile : alpha selon sa position dans les bandes de fondu.
      const zp = this.pos.s - this.offset;
      const aL = fadeL > 0 ? Math.min(1, Math.max(0, zp / fadeL)) : 1;
      const aR = fadeR > 0 ? Math.min(1, Math.max(0, (zw - zp) / fadeR)) : 1;
      starSepEl.style.opacity = (Math.min(aL, aR) * this.fadeA).toFixed(3);
    },

    // Dégradé en coordonnées ZONE, décalé en coordonnées SPAN via
    // background-position. rgba(couleur, 0) plutôt que "transparent"
    // (évite les franges grises d'interpolation).
    grad(el, base, start, fadeL, fadeR, zw) {
      const c = hexToRgba(base, this.fadeA);
      const t = hexToRgba(base, 0);
      el.style.backgroundImage = 'linear-gradient(90deg,'
        + t + ' 0px,' + c + ' ' + fadeL + 'px,'
        + c + ' ' + (zw - fadeR) + 'px,' + t + ' ' + zw + 'px)';
      el.style.backgroundPosition = (this.offset - start) + 'px 0px';
    },
  };
  blockMarquee.painter = painter;

  // Re-mesurer une fois la police Google chargée (les largeurs changent).
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => blockMarquee.reset());
  }

  const stardust = createStardust(ambientLayer, burstLayer, {
    ambient: AMBIENT_STAR_COLOR,
    burst: BURST_STAR_COLOR,
  });

  // Mode démo : si les identifiants Spotify sont absents, on affiche des
  // morceaux fictifs avec toutes les animations (dont le swap), pour
  // prévisualiser le visuel sans Spotify.
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
  let barResetUntil = 0;   // pendant le recul animé, la boucle de rendu attend
  let renderTimer = null;
  function ensureRenderLoop() {
    if (renderTimer) return;
    renderTimer = setInterval(() => {
      if (Date.now() < barResetUntil) return;   // recul en cours : on n'écrase pas
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

  // ===== Reset animé (le moment élégant) =====
  // 1. L'ancien bloc s'efface en glissant, le nouveau arrive en défilant
  //    vers la droite (fondu + glissement).
  // 2. En parallèle, la barre RECULE vers 0 avec une transition douce au
  //    lieu de sauter, puis reprend sa progression normale.
  //
  // ANTI-FLOU (2 niveaux) :
  // - positions en rAF main-thread, snappées au pixel entier ;
  // - JAMAIS d'opacity sur le bloc : l'étoile (pulsation CSS composée)
  //   vit sur sa propre couche GPU, et une opacité de groupe sur son
  //   conteneur forcerait la promotion du bloc ENTIER -> texte rasterisé
  //   en bitmap -> flou pendant tout le fondu. À la place, le fondu passe
  //   par l'ALPHA DE LA COULEUR du texte (peinture directe, glyphes nets)
  //   et une opacité posée sur l'étoile seule (sa micro-couche à elle).
  //   Les text-shadow sont coupées pendant le fondu (elles dessinent la
  //   silhouette du glyphe indépendamment de l'alpha de sa couleur ->
  //   texte fantôme sinon) puis restaurées.
  let swapSeq = 0;

  // Fondu global du bloc : une seule source de vérité, le painter, qui
  // sait l'appliquer dans les deux modes (statique = alpha des couleurs ;
  // défilement = alpha des dégradés, fondus de bord préservés).
  function setBlockFade(a) {
    painter.fadeA = a;
    if (painter.scrolling) painter.frame(painter.offset);
    else painter.applyStatic();
  }
  function clearBlockFade() {
    setBlockFade(1);   // à 1, applyStatic restaure tout ('' -> variables CSS)
  }

  function setBlockText(name, artistName) {
    titleEl.textContent = name || '';
    artistEl.textContent = artistName || '';
    blockMarquee.reset();
  }

  // Chorégraphie validée en démo : vraie sortie vers la gauche puis entrée
  // voyageant vers la droite, fondu lié au mouvement.
  const SWAP_TRAVEL = 80;                 // distance de voyage (px)
  const SWAP_OUT_MS = 540;                // 45% de 1200ms — sortie accélérée
  const SWAP_IN_MS  = 660;                // 55% de 1200ms — entrée amortie

  function swapTo(name, artistName) {
    const seq = ++swapSeq;                 // annule tout swap en cours
    blockMarquee.stop();                   // fige le défilement à sa position
    const startMl = parseFloat(blockEl.style.marginLeft) || 0;
    const a0 = painter.fadeA;
    // (ombres de texte gérées par le painter dès la première frame de fondu)

    // Sortie : le bloc ACCÉLÈRE vers la gauche (easeInCubic, aspiré hors de
    // la pilule) pendant que le fondu suit sa course. Positions snappées au
    // PIXEL ENTIER (une position fractionnaire = texte flou).
    animateStyles(SWAP_OUT_MS, (p) => {
      if (seq !== swapSeq) return true;
      setBlockFade(a0 * (1 - easeInOut(p)));
      blockEl.style.marginLeft = Math.round(startMl - SWAP_TRAVEL * easeInCubic(p)) + 'px';
    }, () => {
      if (seq !== swapSeq) return;
      setBlockText(name, artistName);      // reset() remet marginLeft à 0
      setBlockFade(0);
      blockEl.style.marginLeft = '-' + SWAP_TRAVEL + 'px';
      // Entrée : le nouveau bloc DÉCÉLÈRE vers la droite depuis le point de
      // sortie (easeOutCubic), fondu révélé au fil du voyage. La pause
      // initiale du marquee (4s) couvre largement l'entrée -> aucune
      // concurrence sur marginLeft.
      animateStyles(SWAP_IN_MS, (p) => {
        if (seq !== swapSeq) return true;
        const t = easeOutCubic(p);
        setBlockFade(t);
        blockEl.style.marginLeft = Math.round(-SWAP_TRAVEL * (1 - t)) + 'px';
      }, () => {
        if (seq !== swapSeq) return;
        clearBlockFade();
        blockEl.style.marginLeft = '0px';
      });
    });
  }

  function animateBarReset() {
    barResetUntil = Date.now() + 680;
    progressBarEl.classList.add('np-bar-reset');
    progressBarEl.style.width = '0%';
    setTimeout(() => progressBarEl.classList.remove('np-bar-reset'), 680);
  }

  // ===== Rendu texte =====
  function renderTrack(name, artistName) {
    const key = name + '|' + artistName;
    if (key === st.key) { st.hasContent = true; return; }
    const firstFill = (st.key === null);
    st.key = key;
    if (firstFill || !visShown) {
      // Premier remplissage ou carte masquée : pas de théâtre, on pose le texte.
      setBlockText(name, artistName);
    } else {
      // Changement à l'écran : reset animé complet (bloc + barre).
      swapTo(name, artistName);
      animateBarReset();
    }
    st.hasContent = true;
  }

  function showPlaceholder() {
    renderTrack(PLACEHOLDER_TITLE, PLACEHOLDER_ARTIST);
    st.durationMs = 0;
    st.isPlaying = false;
    if (Date.now() >= barResetUntil) progressBarEl.style.width = '0%';
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
    if (Date.now() >= barResetUntil) progressBarEl.style.width = '100%';
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
    const demoTracks = [
      ['Blinding Lights', 'The Weeknd'],
      ['Save Your Tears (Remix) — Bonus Track Edition', 'The Weeknd, Ariana Grande'],
      ['As It Was', 'Harry Styles'],
    ];
    let di = 0;

    st.isPlaying = true;
    st.durationMs = 22000;
    st.anchorMs = 0;
    st.anchorAt = Date.now();
    renderTrack(demoTracks[0][0], demoTracks[0][1]);
    ensureRenderLoop();
    setIdle(false);
    appear();

    // Boucle de la barre (22s), avec reprise à 0.
    setInterval(() => {
      if (Date.now() - st.anchorAt > st.durationMs) st.anchorAt = Date.now();
    }, 400);

    // Alternance de pistes pour montrer le RESET ANIMÉ (swap + recul de barre).
    setInterval(() => {
      di = (di + 1) % demoTracks.length;
      st.anchorMs = 0;
      st.anchorAt = Date.now();
      renderTrack(demoTracks[di][0], demoTracks[di][1]);
      if (visShown) { /* animateBarReset déjà déclenché via renderTrack */ }
    }, 13000);

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
        }, 28000);
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