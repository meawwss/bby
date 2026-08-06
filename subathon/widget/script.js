/* ============================================================
   SUBATHON WIDGET — StreamElements
   Colle ce bloc dans l'onglet JS

   Points clés :
   - le timer est persisté via SE_API.store (survit à un refresh / crash OBS)
   - on stocke une DATE DE FIN absolue, jamais un nombre de secondes restantes
   - les gift bombs sont dédupliquées (récap vs events individuels)
   - `amount` d'un resub = nombre de MOIS, pas un multiplicateur
   ============================================================ */

(function () {
  'use strict';

  /* ---------------------------------------------------------
     Réglages par défaut — écrasés par les Fields StreamElements
     --------------------------------------------------------- */
  var D = {
    scale: 1,
    fontFamily: 'Fredoka',

    storeKey: 'subathon_v1',
    action: 'none',
    setTimeTo: '',
    startHours: 3,
    startMinutes: 30,
    maxHours: 0,                 // 0 = pas de plafond
    offlineBehaviour: 'pause',   // 'pause' | 'run'
    beatSeconds: 30,             // periodicite du battement de coeur

    secSubT1: 300, secSubT2: 600, secSubT3: 1500, secSubPrime: 300,
    giftTimeFactor: 1,
    secPer100Bits: 60,
    secPerTipUnit: 30,
    secPerFollow: 10,
    followsMaxPerHour: 0,   // 0 = pas de plafond

    ptsSubT1: 1, ptsSubT2: 1, ptsSubT3: 1, ptsSubPrime: 1,
    giftPointsFactor: 1,
    ptsPer100Bits: 0,
    ptsPerTipUnit: 0,
    ptsPerFollow: 0,

    goalsList: '10 gift subs|50; terror movie night|100; karaoke night|150; cooking stream|200',
    goalsVisible: 4,
    goalFontSize: 21,
    longLabels: 'shrink',
    goalsMode: 'batch',          // 'batch' | 'slide'
    goalsKeepDone: 2,
    rotateDelay: 6,

    alertText: 'un objectif est atteint!',
    alertDuration: 6,
    miniAlerts: 'on',
    miniDuration: 3,

    giftMode: 'individual',      // 'individual' | 'bulk'
    commandsEnabled: 'on',
    commandsWho: 'owner',
    consoleLogs: 'on',
    instanceSync: 'on',
    debugPanel: 'off',

    glowColor: '#B4CC80',
    glowSize: 7,
    foliageSize: 76,
    windAmp: 45, windBob: 45, windSpeed: 50,
    tlOrientation: 'rot180',
    creamColor: '#FFFBF3',
    oliveColor: '#767E4B',
    leaf1Color: '#ABC776',
    leaf2Color: '#9BBB63',
    leaf3Color: '#C2D897',
    alertBgColor: '#FFFBF3',
    alertBackground: 'off',
    alertBgOpacity: 55,
    alertTextColor: '#515731',
    glowOpacity: 50
  };

  var F = {};
  for (var k in D) F[k] = D[k];

  /* ---------------------------------------------------------
     État persistant
     --------------------------------------------------------- */
  var S = {
    endsAt: 0,
    paused: false,
    pauseRemain: 0,
    points: 0,
    windowStart: 0,
    booted: false
  };

  var initStarted = false;
  var el = {}, rows = {}, goals = [], seen = [], recents = [], simSeq = 0,
      alertQueue = [], alertPhase = 'idle', alertJusqua = 0,
      rotateTimer = null, saveTimer = null, lastTimerStr = '';

  /* ---------------------------------------------------------
     Journal console. Tout passe par ici pour pouvoir le couper
     d'un seul champ le jour du live.
     --------------------------------------------------------- */
  var C_TITLE = 'color:#B4CC80;font-weight:bold',
      C_INFO  = 'color:#8ab4f8',
      C_OK    = 'color:#7ec46b',
      C_SKIP  = 'color:#d9a441',
      C_WARN  = 'color:#e07a5f;font-weight:bold';

  function L(css, msg) {
    if (F.consoleLogs === 'off') return;
    console.log('%c[SUBATHON] ' + msg, css);
  }
  function Lraw(label, obj) {
    if (F.consoleLogs === 'off') return;
    var champs = '';
    try {
      if (obj && typeof obj === 'object' && !(obj instanceof Array)) {
        champs = '   [champs : ' + Object.keys(obj).join(', ') + ']';
      }
    } catch (e) {}
    console.log('%c[SUBATHON] ' + label + champs, C_INFO, obj);
  }
  function etat() {
    return Math.round(S.points) + ' pt · ' + fmt(remaining()) +
           ' · palier suivant ' + activeTarget() +
           (S.paused ? ' · EN PAUSE' : '');
  }

  /* Identifiant unique de CETTE instance, et numero de revision de l-etat.
     StreamElements renvoie `kvstore:update` a tous les widgets, y compris
     celui qui vient d-ecrire : sans ces deux reperes, une instance adopte
     l-echo de sa propre sauvegarde — figee au moment de l-ecriture, donc
     perimee si un event est arrive entre-temps — et le compteur recule. */
  var INSTANCE = 'i' + Math.random().toString(36).slice(2, 8) +
                 Date.now().toString(36).slice(-4);

  /* Battement de coeur : l-etat sauvegarde porte l-heure de sa derniere
     ecriture. Au demarrage, l-ecart entre ce battement et maintenant donne
     la duree pendant laquelle le widget n-a pas tourne — typiquement OBS
     ferme. On peut alors rendre ce temps au chrono. */
  var derniereEcriture = 0;

  // pseudo de la chaine, fourni par StreamElements au chargement : sert a
  // reconnaitre la proprietaire meme si les badges manquent
  var CHAINE = '';

  var $ = function (s) { return document.querySelector(s); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var num = function (v, f) { var n = parseFloat(v); return isNaN(n) ? f : n; };

  /* ---------------------------------------------------------
     Persistance
     --------------------------------------------------------- */
  function hasStore() {
    return typeof SE_API !== 'undefined' && SE_API && SE_API.store;
  }
  function ecrire() {
      S.rev = num(S.rev, 0) + 1;
      S.by = INSTANCE;
      S.beat = derniereEcriture = Date.now();
      try {
        // copie figee : SE peut serialiser plus tard, l-objet vivant bougerait
        var ecriture = SE_API.store.set(F.storeKey, JSON.parse(JSON.stringify(S)));
        // Une sauvegarde qui echoue en silence serait grave : le battement
        // resterait fige et, au prochain demarrage, le widget croirait a une
        // absence alors qu-il tournait. On le signale donc bruyamment.
        if (ecriture && typeof ecriture['catch'] === 'function') {
          ecriture['catch'](function (e) {
            console.warn('[SUBATHON] ÉCHEC DE SAUVEGARDE — état non enregistré', e);
          });
        }
      } catch (e) { console.warn('[SUBATHON] ÉCHEC DE SAUVEGARDE', e); }
  }

  /* Ecriture differee : pendant une rafale, on n-ecrit qu-une fois a la fin. */
  function save() {
    if (!hasStore()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(ecrire, 350);
  }

  /* Ecriture immediate, pour la toute premiere sauvegarde au demarrage :
     si OBS etait tue dans la seconde, un magasin vide ferait repartir le
     chrono de sa duree initiale. */
  function saveNow() {
    if (!hasStore()) return;
    clearTimeout(saveTimer);
    ecrire();
  }
  function loadState(cb) {
    if (!hasStore()) return cb(null);
    var done = false;
    var finish = function (v) { if (!done) { done = true; cb(v); } };
    setTimeout(function () { finish(null); }, 2500);   // filet de sécurité
    try {
      Promise.resolve(SE_API.store.get(F.storeKey)).then(function (d) {
        finish(d && typeof d === 'object' && typeof d.endsAt === 'number' ? d : null);
      })['catch'](function () { finish(null); });
    } catch (e) { finish(null); }
  }

  /* ---------------------------------------------------------
     Timer
     --------------------------------------------------------- */
  function remaining() {
    return S.paused ? Math.max(0, S.pauseRemain) : Math.max(0, S.endsAt - Date.now());
  }
  function capTime() {
    if (F.maxHours > 0) {
      var max = F.maxHours * 3600000;
      if (S.paused) S.pauseRemain = Math.min(S.pauseRemain, max);
      else if (S.endsAt - Date.now() > max) S.endsAt = Date.now() + max;
    }
  }
  /* Une « époque » distingue les actions VOLONTAIRES — reset, pause, retrait
     de temps — des simples crédits d-events. Les premières doivent pouvoir
     faire baisser le compteur ; les secondes, jamais. */
  function nouvelleEpoque() { S.epoch = num(S.epoch, 0) + 1; }

  function addTime(sec) {
    if (!sec) return;
    if (sec < 0) nouvelleEpoque();
    L(C_OK, '     temps  ' + fmt(remaining()) + '  →  ' +
            fmt(Math.max(0, remaining() + sec * 1000)) +
            '   (' + (sec > 0 ? '+' : '') + Math.round(sec) + ' s)');
    if (S.paused) S.pauseRemain = Math.max(0, S.pauseRemain + sec * 1000);
    else S.endsAt = Date.now() + remaining() + sec * 1000;
    capTime(); save(); paintTimer();
  }
  function setTime(sec) {
    nouvelleEpoque();
    if (S.paused) S.pauseRemain = Math.max(0, sec * 1000);
    else S.endsAt = Date.now() + Math.max(0, sec * 1000);
    capTime(); save(); paintTimer();
  }
  /* Remise a zero complete. Centralisee : les trois chemins — action des
     Fields, commande !subathon reset, bouton du panneau de test — passent
     par ici. Sans cela, chacun oubliait un detail : l-animation de pause
     restait sur le chrono alors que le decompte avait repris. */
  function toutReinitialiser() {
    nouvelleEpoque();
    S.points = 0;
    S.windowStart = 0;
    S.paused = false;
    S.pauseRemain = 0;
    followsVus = [];
    followsRecents = [];
    setTime(F.startHours * 3600 + F.startMinutes * 60);
    rafraichirPause();
    syncGoals(false);
    save();
  }

  /* L-etat visuel de pause doit toujours suivre S.paused, quel que soit le
     chemin qui l-a modifie. */
  function rafraichirPause() {
    if (el.timer) el.timer.classList.toggle('is-paused', S.paused);
  }

  function setPaused(p) {
    if (p === S.paused) return;
    nouvelleEpoque();
    if (p) { S.pauseRemain = remaining(); S.paused = true; }
    else { S.paused = false; S.endsAt = Date.now() + S.pauseRemain; }
    rafraichirPause();
    save(); paintTimer();
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60);   s -= m * 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }
  function paintTimer() {
    // le DOM peut ne pas etre pret : un event recu pendant l-initialisation
    // levait une exception qui interrompait tout le traitement
    if (!el.timer) return;
    var str = fmt(remaining());
    if (str === lastTimerStr) return;
    lastTimerStr = str;
    var html = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charAt(i);
      html += c === ':' ? '<span class="sb-c">:</span>' : '<span class="sb-d">' + c + '</span>';
    }
    el.timer.innerHTML = html;
  }

  /* ---------------------------------------------------------
     Goals
     --------------------------------------------------------- */
  function parseGoals(raw) {
    return String(raw || '')
      .split(/[\n;]+/)
      .map(function (l) { return l.trim(); })
      .filter(Boolean)
      .map(function (l) {
        var i = l.lastIndexOf('|');
        if (i < 0) return { label: l, value: 0 };
        return {
          label: l.slice(0, i).trim(),
          value: num(l.slice(i + 1).replace(',', '.'), 0)
        };
      })
      .filter(function (g) { return g.label; });
  }
  function isDone(i) { return goals[i] && S.points >= goals[i].value; }
  function firstIncomplete() {
    for (var i = 0; i < goals.length; i++) if (!isDone(i)) return i;
    return goals.length;
  }
  function activeTarget() {
    var i = firstIncomplete();
    if (i < goals.length) return goals[i].value;
    return goals.length ? goals[goals.length - 1].value : 0;
  }
  function targetWindowStart() {
    var n = Math.max(1, F.goalsVisible), max = Math.max(0, goals.length - n);
    if (F.goalsMode === 'slide') {
      return clamp(firstIncomplete() - Math.max(0, F.goalsKeepDone), 0, max);
    }
    // mode "batch" : on n'avance que lorsque toute la fournée est cochée
    var start = S.windowStart;
    while (start + n <= goals.length - 1) {
      var all = true;
      for (var i = start; i < Math.min(start + n, goals.length); i++) {
        if (!isDone(i)) { all = false; break; }
      }
      if (!all) break;
      start += n;
    }
    return clamp(start, 0, max);
  }
  /* `force` : redessiner meme si la fenetre n-a pas a bouger. Indispensable
     apres une synchronisation, ou windowStart a DEJA ete recopie depuis
     l-autre instance : sans cela la comparaison est vraie, rien n-est
     redessine, et l-affichage reste bloque sur l-ancienne fournee. */
  function scheduleRotate(force) {
    clearTimeout(rotateTimer);
    rotateTimer = setTimeout(function () {
      var t = targetWindowStart();
      if (t !== S.windowStart) { S.windowStart = t; save(); syncGoals(false); }
      else if (force) syncGoals(false);
    }, Math.max(0, F.rotateDelay) * 1000);
  }

  function makeRow(i) {
    var d = document.createElement('div');
    d.className = 'sb-goal';
    d.dataset.i = i;
    var lab = document.createElement('span');
    lab.className = 'sb-goal__label';
    var txt = document.createElement('span');
    txt.className = 'sb-goal__text';
    txt.textContent = goals[i].label;
    lab.appendChild(txt);
    var val = document.createElement('span');
    val.className = 'sb-goal__value';
    val.textContent = goals[i].value;
    d.appendChild(lab); d.appendChild(val);
    return d;
  }

  /* Ajustement des libelles trop longs pour la ligne. Trois strategies, au
     choix du client : reduire la police jusqu-a ce que ca rentre, faire
     defiler doucement, ou tronquer. */
  /* Ajustement des libelles trop longs. Deux precautions apprises a l-usage :

     1. On NE reinitialise PAS la taille avant d-avoir verifie qu-on peut
        mesurer. Sinon, quand la largeur vaut 0 — page masquee, rendu en
        cours, police Google pas encore chargee — la ligne repart a la taille
        pleine et deborde, sans que rien ne la repare.
     2. Une mesure impossible est REESSAYEE un peu plus tard, au lieu d-etre
        abandonnee. C-est ce qui rend le resultat identique sur toutes les
        instances, quel que soit leur etat au moment du rendu. */
  function fitLabel(node, essai) {
    var lab = node.querySelector('.sb-goal__label');
    var txt = node.querySelector('.sb-goal__text');
    if (!lab || !txt) return;

    var avail = lab.clientWidth;
    if (!avail) {                       // mesure impossible pour l-instant
      if ((essai || 0) < 12) {
        setTimeout(function () {
          if (node.parentNode) fitLabel(node, (essai || 0) + 1);
        }, 120);
      }
      return;
    }

    node.classList.remove('sb-goal--scroll', 'sb-goal--clip');
    txt.style.fontSize = '';
    txt.style.removeProperty('--sc-dist');

    var need = txt.scrollWidth;
    if (!need) return;
    if (need <= avail + 1) return;      // rentre tel quel

    if (F.longLabels === 'scroll') {
      var dist = need - avail;
      node.classList.add('sb-goal--scroll');
      txt.style.setProperty('--sc-dist', dist + 'px');
      txt.style.setProperty('--sc-dur', (7 + dist / 16).toFixed(1) + 's');
    } else if (F.longLabels === 'clip') {
      node.classList.add('sb-goal--clip');
    } else {
      // reduction : on descend jusqu-a ce que ca rentre, sans passer sous 13 px
      var size = Math.max(13, F.goalFontSize * (avail / need));
      txt.style.fontSize = size.toFixed(1) + 'px';
      if (txt.scrollWidth > lab.clientWidth + 1) node.classList.add('sb-goal--clip');
    }
  }

  function syncGoals(initial) {
    if (!el.goals) return;
    if (initial) { el.goals.innerHTML = ''; rows = {}; }
    var n = Math.max(1, F.goalsVisible);
    var start = clamp(S.windowStart, 0, Math.max(0, goals.length - 1));
    var want = [];
    for (var i = start; i < Math.min(start + n, goals.length); i++) want.push(i);

    // sortie
    Object.keys(rows).forEach(function (key) {
      if (want.indexOf(+key) === -1) {
        var node = rows[key];
        delete rows[key];
        node.classList.add('is-leaving');
        setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 520);
      }
    });

    // entrée + remise en ordre
    var prev = null;
    want.forEach(function (idx) {
      var node = rows[idx], fresh = false;
      if (!node) {
        node = rows[idx] = makeRow(idx);
        fresh = true;
        /* On pose l-etat d-arrivee AVANT l-insertion, puis on force le calcul
           du style avant de le retirer : la transition demarre sans passer par
           requestAnimationFrame, suspendu dans un onglet en arriere-plan. */
        if (!initial) node.classList.add('is-entering');
        el.goals.appendChild(node);
        if (!initial) {
          void node.offsetWidth;
          node.classList.remove('is-entering');
        }
      }
      if (!fresh && node.previousElementSibling !== prev) {
        if (prev) prev.parentNode.insertBefore(node, prev.nextSibling);
        else el.goals.insertBefore(node, el.goals.firstChild);
      }
      prev = node;

      var done = isDone(idx);
      if (done && !node.classList.contains('is-done')) {
        node.classList.add('is-done');
        if (!initial) {
          node.classList.add('is-hit');
          setTimeout(function () { node.classList.remove('is-hit'); }, 520);
        }
      } else if (!done) {
        node.classList.remove('is-done');
      }
    });

    /* Ajustement des libelles : la lecture de clientWidth force elle-meme le
       calcul de mise en page, on peut donc le faire tout de suite. Passer par
       requestAnimationFrame laisserait les libelles non ajustes tant que
       l-onglet reste en arriere-plan. */
    want.forEach(function (idx) { if (rows[idx]) fitLabel(rows[idx]); });

    el.counter.textContent = Math.round(S.points) + '/' + activeTarget();
  }

  function addPoints(p) {
    if (!p) return;
    if (p < 0) nouvelleEpoque();
    L(C_OK, '     points ' + Math.round(S.points) + '  →  ' + Math.round(S.points + p) +
            '   (' + (p > 0 ? '+' : '') + p + ')');
    var before = firstIncomplete();
    S.points = Math.max(0, S.points + p);
    var after = firstIncomplete();

    if (after > before) {
      // un ou plusieurs objectifs viennent de tomber
      for (var i = before; i < after && i < goals.length; i++) {
        L(C_TITLE, '     ✔ OBJECTIF ATTEINT : « ' + goals[i].label +
                   ' » (' + goals[i].value + ')');
        pushAlert(String(F.alertText).replace(/\{goal\}/gi, goals[i].label));
      }
      scheduleRotate();
    }
    /* Un retrait de points est une correction manuelle : la fenetre doit
       pouvoir redescendre, exactement comme sur setPoints. Sans cela,
       « !points -50 » barrait des objectifs sans jamais revenir en arriere. */
    if (p < 0) recalculerFenetre();
    save();
    syncGoals(false);
  }

  /* Reglage ABSOLU des points, en une operation autoritaire.

     `addPoints` ne monte l-epoque que sur un delta negatif : une valeur posee
     a la hausse n-est donc pas marquee comme volontaire, et se fait battre au
     maximum par une instance restee sur un chiffre plus haut. C-est le piege
     dans lequel tombe toute correction manuelle faite a chaud.

     Ici on monte l-epoque dans tous les cas : la valeur s-impose aux autres
     instances, a la hausse comme a la baisse. Aucune alerte n-est jouee — une
     correction manuelle n-est pas un objectif atteint. */
  /* La fenetre d-objectifs ne fait qu-AVANCER : en mode « fournee »,
     targetWindowStart() part de S.windowStart et ne redescend jamais. Apres
     toute correction MANUELLE a la baisse, la liste resterait donc bloquee
     sur l-ancienne fournee. On la recalcule depuis zero.

     Indispensable et pas cosmetique : une commande chat est recue par TOUTES
     les instances, chacune avec son propre windowStart, et l-ecriture qui
     suit est autoritaire. Sans recalcul, l-instance restee sur une fournee
     haute la reimposerait a toutes les autres. */
  function recalculerFenetre() {
    recalculerFenetre();
  }

  function setPoints(p) {
    nouvelleEpoque();
    var avant = firstIncomplete();
    var ancien = S.points;
    S.points = Math.max(0, num(p, 0));

    /* La fenetre d-objectifs ne fait qu-AVANCER : en mode « fournee »,
       targetWindowStart() part de S.windowStart et ne redescend jamais. Apres
       une correction a la baisse, la liste resterait donc bloquee sur
       l-ancienne fournee. On la recalcule depuis zero.

       C-est indispensable ici, et pas seulement cosmetique : la commande est
       recue par TOUTES les instances, chacune avec son propre windowStart, et
       l-ecriture qui suit est autoritaire. Sans ce recalcul, l-instance restee
       sur une fournee haute la reimposerait a toutes les autres. */
    S.windowStart = 0;
    S.windowStart = targetWindowStart();
    L(C_TITLE, 'REGLAGE MANUEL : points ' + Math.round(ancien) + '  →  ' +
               Math.round(S.points) + '   (s-impose aux autres instances)');
    save();
    syncGoals(false);
    if (firstIncomplete() !== avant || targetWindowStart() !== S.windowStart) {
      scheduleRotate(true);
    }
    L(C_INFO, '     etat : ' + etat());
  }

  /* ---------------------------------------------------------
     Alerte
     --------------------------------------------------------- */
  /* L-alerte est pilotee par des HORODATAGES relus a chaque tick, et non par
     des minuteries chainees. Deux raisons :

     1. `requestAnimationFrame` est suspendu dans un onglet en arriere-plan.
        L-utiliser pour declencher la transition laissait l-alerte apparaitre
        au retour sur l-onglet, apres que la sequence de masquage soit deja
        passee — donc bloquee a l-ecran jusqu-a l-alerte suivante.
     2. `setTimeout` est fortement ralenti dans ces memes onglets. Avec des
        horodatages, l-etat reste juste quoi qu-il arrive : au pire l-alerte
        disparait des le premier tick qui suit. */
  function pushAlert(text) {
    if (!el.alert) return;
    alertQueue.push(text);
    if (alertQueue.length > 5) alertQueue.shift();   // pas d-embouteillage
    tickAlert();
  }

  function tickAlert() {
    if (!el.alert) return;
    var maintenant = Date.now();

    if (alertPhase === 'shown' && maintenant >= alertJusqua) {
      el.alert.classList.remove('is-on');
      alertPhase = 'hiding';
      alertJusqua = maintenant + 600;
      return;
    }
    if (alertPhase === 'hiding' && maintenant >= alertJusqua) {
      el.alert.classList.add('sb-alert--reserve');
      alertPhase = 'idle';
    }
    if (alertPhase === 'idle' && alertQueue.length) {
      el.alertText.textContent = alertQueue.shift();
      el.alert.classList.remove('sb-alert--reserve');
      // lecture forcee : declenche le recalcul de style sans passer par rAF
      void el.alert.offsetWidth;
      el.alert.classList.add('is-on');
      alertPhase = 'shown';
      alertJusqua = Date.now() + Math.max(1, F.alertDuration) * 1000;
    }
  }

  /* ---------------------------------------------------------
     Mini-alerte : « 5 subs  + 25 min », épinglée sur le timer.

     Deux precautions heritees des bugs precedents :
     - pilotage par HORODATAGE relu a chaque tick, jamais par des minuteries
       chainees, pour rester juste dans un onglet en arriere-plan ;
     - declenchement de la transition par lecture forcee du style, jamais par
       requestAnimationFrame, qui est suspendu dans ces memes onglets.

     Les credits sont AGREGES sur une courte fenetre : un gift bomb arrive en
     dix events separes, on veut « 10 subs + 50 min » et non dix pilules.
     --------------------------------------------------------- */
  var miniCumul = null, miniJusqua = 0, miniFenetre = 0, dernierMiniId = '';
  var followsVus = [], followsRecents = [];

  function dureeCourte(sec) {
    sec = Math.round(sec);
    if (sec < 60) return sec + ' s';
    var m = Math.round(sec / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return r ? h + ' h ' + r : h + ' h';
  }
  function nomTier(t) {
    return t === 'prime' ? 'prime' : t === '3000' ? 'T3' : t === '2000' ? 'T2' : '';
  }
  function libelleMini(a) {
    var bouts = [], n;
    if (a.subs) {
      n = a.subs;
      var tier = a.tier;
      /* Un Prime ne peut pas etre offert sur Twitch. Si la source envoie
         quand meme cette combinaison — l-emulateur de StreamElements le fait —
         on tait le tier plutot que d-afficher « 1 prime offert ». */
      if (a.offert === true && tier === 'prime') tier = '';
      // un Prime non offert se nomme « 1 prime », pas « 1 sub prime »
      var mot = tier === 'prime'
        ? n + ' prime' + (n > 1 ? 's' : '')
        : n + ' sub' + (n > 1 ? 's' : '') + (tier ? ' ' + tier : '');
      // l-info « offert » compte autant que le tier pour la streameuse
      if (a.offert === true) mot += n > 1 ? ' offerts' : ' offert';
      bouts.push(mot);
    }
    if (a.bits) bouts.push(a.bits.toLocaleString('fr-FR') + ' bits');
    if (a.tips) bouts.push('don');
    if (a.follows) bouts.push(a.follows + ' follow' + (a.follows > 1 ? 's' : ''));
    return bouts.join(' · ');
  }

  function creditMini(genre, nombre, secondes, tier, id, offert) {
    if (secondes <= 0) return;
    var maintenant = Date.now();
    if (!miniCumul || maintenant > miniFenetre) {
      miniCumul = { subs: 0, bits: 0, tips: 0, follows: 0, sec: 0, tier: null, offert: null };
    }
    miniCumul[genre] += nombre;
    miniCumul.sec += secondes;
    if (genre === 'subs') {
      var t = nomTier(tier);
      // tiers melanges dans une meme salve : on n-affiche aucun tier
      miniCumul.tier = miniCumul.tier === null ? t : (miniCumul.tier === t ? t : '');
      // idem pour « offert » : melange offerts et non offerts, on se tait
      miniCumul.offert = miniCumul.offert === null ? !!offert
                       : (miniCumul.offert === !!offert ? !!offert : null);
    }
    miniFenetre = maintenant + 1500;
    miniJusqua = maintenant + Math.max(1, num(F.miniDuration, 3)) * 1000;

    /* Le detail part dans la sauvegarde : une instance qui n-a pas recu
       l-event pourra afficher « 10 subs + 50 min » et pas seulement la duree.
       L-identifiant vient de l-event lui-meme quand il en a un, de sorte que
       deux instances ayant recu le meme event calculent le meme, et que
       l-une n-affiche pas en double ce que l-autre a deja montre. */
    dernierMiniId = String(id || ('loc' + maintenant));
    S.miniLast = { subs: miniCumul.subs, bits: miniCumul.bits, tips: miniCumul.tips,
                   follows: miniCumul.follows,
                   sec: miniCumul.sec, tier: miniCumul.tier,
                   offert: miniCumul.offert, id: dernierMiniId };

    if (F.miniAlerts !== 'off' && el.mini) peindreMini();
  }

  function miniDepuis(ml) {          // detail recu d-une autre instance
    if (F.miniAlerts === 'off' || !el.mini) return;
    miniCumul = { subs: num(ml.subs, 0), bits: num(ml.bits, 0), tips: num(ml.tips, 0),
                  follows: num(ml.follows, 0),
                  sec: num(ml.sec, 0), tier: ml.tier || null,
                  offert: ml.offert === true ? true : null };
    miniFenetre = 0;
    miniJusqua = Date.now() + Math.max(1, num(F.miniDuration, 3)) * 1000;
    peindreMini();
  }

  function miniBrut(secondes) {         // credit dont on ignore l-origine
    if (F.miniAlerts === 'off' || !el.mini || secondes <= 0) return;
    miniCumul = { subs: 0, bits: 0, tips: 0, sec: secondes, tier: null };
    miniFenetre = 0;
    miniJusqua = Date.now() + Math.max(1, num(F.miniDuration, 3)) * 1000;
    peindreMini();
  }

  function peindreMini() {
    if (!el.mini || !miniCumul) return;
    var texte = libelleMini(miniCumul);
    el.mini.innerHTML = (texte ? '<b>' + texte + '</b>' : '') +
                        '<i>+ ' + dureeCourte(miniCumul.sec) + '</i>';
    // lecture forcee : declenche la transition sans passer par rAF
    void el.mini.offsetWidth;
    el.mini.classList.add('is-on');
  }

  function tickMini() {
    if (!el.mini) return;
    if (miniJusqua && Date.now() >= miniJusqua) {
      el.mini.classList.remove('is-on');
      miniJusqua = 0;
    }
  }

  /* ---------------------------------------------------------
     Events StreamElements
     --------------------------------------------------------- */
  function tierOf(data) {
    var t = String(data.tier || '1000').toLowerCase();
    if (t.indexOf('prime') > -1) return 'prime';
    if (t === '3000' || t === '3') return '3000';
    if (t === '2000' || t === '2') return '2000';
    return '1000';
  }
  function secForTier(t) {
    return t === 'prime' ? F.secSubPrime
         : t === '3000'  ? F.secSubT3
         : t === '2000'  ? F.secSubT2
         : F.secSubT1;
  }
  function ptsForTier(t) {
    return t === 'prime' ? F.ptsSubPrime
         : t === '3000'  ? F.ptsSubT3
         : t === '2000'  ? F.ptsSubT2
         : F.ptsSubT1;
  }

  /* --- GIFT BOMBS -----------------------------------------------------

     Twitch annonce une bombe par un event RECAPITULATIF (`bulkGifted`,
     `amount` = nombre de subs offerts), puis envoie normalement un event par
     sub reellement delivre. Mais ce n-est PAS garanti : le bouton
     « Community Gift » de StreamElements n-envoie que le recapitulatif et
     rien derriere.

     Aucune des deux regles simples ne tient donc :
       - compter le recap ET les individuels  → double comptage,
       - ne compter que les individuels       → rien quand ils manquent,
       - ne compter que le recap              → rien quand c-est lui qui manque.

     Regle retenue : le recapitulatif est credite TOUT DE SUITE pour le
     nombre annonce, et il ouvre une avance du meme montant. Les events
     individuels qui suivent viennent consommer cette avance sans rien
     crediter — ils sont deja payes. Une fois l-avance epuisee, ou la fenetre
     expiree, les subs offerts recomptent normalement.

     L-ordre inverse est couvert aussi : si des individuels sont arrives
     AVANT le recapitulatif, ils sont deduits du montant annonce.

     Consequence : aucun delai nulle part, le timer bouge a l-instant meme
     dans les deux cas de figure. */
  var FENETRE_BOMBE  = 60000;   // duree de vie de l-avance ouverte par un recap
  var FENETRE_AVANCE = 15000;   // individuels arrives juste AVANT le recap
  var bombes = [];
  var giftsRecents = {};        // gifteur -> horodatages des subs offerts credites

  function cleGifteur(d) {
    return String((d && (d.sender || d.name)) || '?').toLowerCase();
  }

  function noterGift(cle) {
    var t = Date.now();
    var l = giftsRecents[cle] || (giftsRecents[cle] = []);
    l.push(t);
    while (l.length && t - l[0] > FENETRE_AVANCE) l.shift();
    if (l.length > 200) l.shift();
  }

  function giftsJusteAvant(cle) {
    var t = Date.now(), l = giftsRecents[cle] || [], n = 0, i;
    for (i = 0; i < l.length; i++) if (t - l[i] <= FENETRE_AVANCE) n++;
    return n;
  }

  function bombeDe(cle) {
    var t = Date.now(), i;
    for (i = bombes.length - 1; i >= 0; i--) {
      if (t - bombes[i].t > FENETRE_BOMBE) { bombes.splice(i, 1); continue; }
      if (bombes[i].cle === cle) return bombes[i];
    }
    return null;
  }

  /* Recapitulatif : credit immediat du solde restant a payer. */
  function crediterBombe(data, dejaPaye) {
    var cle = cleGifteur(data);
    var idBombe = idEvent('subscriber-latest', data);
    var nom = data.sender || data.name || '?';
    var tier = tierOf(data);
    var annonce = Math.max(1, parseInt(data.amount, 10) || 1);

    // des individuels ont-ils devance le recapitulatif ?
    var deja = Math.min(annonce, giftsJusteAvant(cle));
    var aPayer = annonce - deja;

    if (deja > 0) {
      L(C_INFO, '     ' + deja + ' event' + (deja > 1 ? 's' : '') +
                ' individuel' + (deja > 1 ? 's' : '') + ' deja compte' +
                (deja > 1 ? 's' : '') + ' avant le recapitulatif — deduit' +
                (deja > 1 ? 's' : '') + ' du montant annonce');
    }

    if (aPayer <= 0) {
      L(C_SKIP, '     rien a crediter : les ' + annonce + ' subs etaient deja comptes');
      return;
    }

    // l-avance couvre les individuels qui vont suivre
    bombes.push({ cle: cle, nom: nom, tier: tier, avance: aPayer, t: Date.now() });
    if (bombes.length > 30) bombes.shift();

    /* Bombe deja payee par une autre instance : on ouvre uniquement la
       fenetre d-absorption, sans rien crediter. */
    if (dejaPaye) {
      L(C_SKIP, '     fenetre d-absorption ouverte pour ' + aPayer + ' sub' +
                (aPayer > 1 ? 's' : '') + ' (deja payes par une autre instance)');
      return;
    }

    var secSub = secForTier(tier) * aPayer * F.giftTimeFactor;
    var ptsSub = ptsForTier(tier) * aPayer * F.giftPointsFactor;

    L(C_TITLE, 'GIFT BOMB · ' + nom + ' offre ' + annonce + ' sub' +
               (annonce > 1 ? 's' : '') + ' — credite immediatement pour ' + aPayer);
    L(C_INFO, '     → ' + Math.round(secSub) + ' s et ' + ptsSub + ' pt' +
              ' · les events individuels qui suivent seront absorbes');

    addTime(secSub);
    addPoints(ptsSub);
    creditMini('subs', aPayer, secSub, tier, idBombe || ('bombe|' + cle), true);
    L(C_INFO, '     etat : ' + etat());
  }

  /* Event individuel d-un sub offert. Renvoie true s-il a deja ete paye par
     le recapitulatif : l-appelant ne doit alors pas crediter. */
  function absorberParBombe(data) {
    var cle = cleGifteur(data);
    var b = bombeDe(cle);

    if (b && b.avance > 0) {
      b.avance--;
      L(C_SKIP, '     absorbe : deja paye par le recapitulatif de ' + b.nom +
                ' (' + b.avance + ' d\'avance restante)');
      return true;
    }

    noterGift(cle);
    return false;
  }

  /* --- IDENTITE D-UN EVENT, IDENTIQUE SUR TOUTES LES INSTANCES ---------

     Deux instances qui recoivent le meme event doivent en calculer le MEME
     identifiant, sinon la protection croisee ne peut pas reconnaitre ce
     qu-une autre a deja paye — et l-event est credite deux fois.

     La plupart des events portent un `_id` : il suffit. Le recapitulatif
     d-un community gift, lui, n-en a PAS (ses champs sont name, sender,
     displayName, amount, count, tier, message, bulkGifted, type,
     originalEventName). On le derive donc de son contenu, qui est identique
     partout. Deux bombes reellement distinctes du meme gifteur, de meme
     taille et de meme tier, se confondraient — mais elles sont separees par
     la fenetre d-absorption, et se confondre est ici moins grave que se
     compter double. */
  function idEvent(listener, data) {
    if (data && data._id) return listener + '|' + data._id;
    if (data && data.bulkGifted === true) {
      return 'bulk|' + String(data.sender || data.name || '?').toLowerCase() +
             '|' + (parseInt(data.amount, 10) || 1) + '|' + tierOf(data);
    }
    return null;
  }

  /* Registre des derniers events credites par CETTE instance. Il voyage dans
     la sauvegarde : une instance qui adopte un etat apprend d-un coup tout ce
     que l-autre a deja paye, et pas seulement le dernier event. */
  function noterCredite(id) {
    if (!id) return;
    if (!S.credited) S.credited = [];
    if (S.credited.indexOf(id) > -1) return;
    S.credited.push(id);
    while (S.credited.length > 40) S.credited.shift();
  }

  function handle(listener, data) {
    if (!listener || !data) return;

    /* Anti-doublon : UNIQUEMENT par identifiant `_id`.

       Chaque vrai event StreamElements en porte un, unique. Deux subs offerts
       par la meme personne, dans la meme seconde, au meme tier, ont donc
       chacun le leur : ils ne peuvent plus se confondre.

       L-ancien filtre « par signature de contenu » comparait pseudo + montant
       + tier + expediteur, et bloquait au-dela de N payloads identiques. Sur
       une gift bomb les events individuels se ressemblent par construction :
       il les avalait les uns apres les autres. C-est LUI qui mangeait les
       gift bombs. Supprime. */
    var TRAITES = { 'subscriber-latest': 1, 'cheer-latest': 1,
                    'tip-latest': 1, 'follower-latest': 1 };
    var idEvt = TRAITES[listener] ? idEvent(listener, data) : null;
    if (idEvt) {
      if (seen.indexOf(idEvt) > -1) {
        L(C_SKIP, 'ignore : deja credite (ici ou sur une autre instance)');
        /* Un recapitulatif deja paye ailleurs ne doit PAS etre credite, mais
           il doit quand meme ouvrir sa fenetre d-absorption : sinon les
           events individuels de la bombe arrivent ensuite sans rien pour les
           absorber, et cette instance les compte en plus du recapitulatif. */
        if (data.bulkGifted === true) crediterBombe(data, true);
        /* Un sub offert deja paye ailleurs doit quand meme consommer l-avance
           de sa bombe ici : sinon l-avance de cette instance reste trop haute
           et absorberait a tort un gift ulterieur du meme gifteur. */
        else if (data.gifted === true || data.isCommunityGift === true) {
          absorberParBombe(data);
        }
        return;
      }
      seen.push(idEvt);
      if (seen.length > 120) seen.shift();
      noterCredite(idEvt);
    }

    if (listener === 'subscriber-latest') {
      var gifted = data.gifted === true || data.gifted === 'true';
      var bulk   = data.bulkGifted === true;
      var tier   = tierOf(data);

      L(C_TITLE, 'SUB  tier=' + tier +
                 ' · offert=' + (gifted ? 'OUI' : 'non') +
                 ' · recapitulatif=' + (bulk ? 'OUI' : 'non') +
                 ' · amount=' + data.amount + ' (jamais utilise comme multiplicateur)');

      /* Chaque sub reellement delivre produit UN event, compte pour 1.

         `amount` n-est JAMAIS un multiplicateur ici : sur un resub c-est un
         nombre de mois, sur un sub offert c-est l-anciennete du destinataire.
         Seul le recapitulatif y met un nombre de subs — il part en
         credit immediat, voir crediterBombe(). */
      if (bulk) { crediterBombe(data); return; }

      /* Sub offert : il appartient peut-etre a une bombe deja creditee. Dans
         ce cas il est absorbe, sinon il compte normalement pour 1. */
      if (gifted || data.isCommunityGift === true) {
        if (absorberParBombe(data)) return;
      }

      var factorT = gifted ? F.giftTimeFactor : 1;
      var factorP = gifted ? F.giftPointsFactor : 1;
      var secSub = secForTier(tier) * factorT;
      var ptsSub = ptsForTier(tier) * factorP;

      L(C_INFO, '     compte pour 1 sub → ' + Math.round(secSub) + ' s et ' + ptsSub + ' pt');

      addTime(secSub);
      addPoints(ptsSub);
      creditMini('subs', 1, secSub, tier,
                 listener + '|' + (data._id || (data.name + '|' + Date.now())), gifted);
      L(C_INFO, '     etat : ' + etat());
      return;
    }

    if (listener === 'cheer-latest') {
      var bits = num(data.amount, 0);
      L(C_TITLE, 'CHEER  ' + bits + ' bits' + (data.name ? ' · ' + data.name : ''));
      if (bits <= 0) { L(C_SKIP, '     ignoré : montant nul ou illisible'); return; }
      L(C_INFO, '     ' + (bits / 100).toFixed(2) + ' × 100 bits → ' +
                Math.round(bits / 100 * F.secPer100Bits) + ' s et ' +
                (bits / 100 * F.ptsPer100Bits) + ' pt');
      var secBits = bits / 100 * F.secPer100Bits;
      addTime(secBits);
      addPoints(bits / 100 * F.ptsPer100Bits);
      creditMini('bits', bits, secBits, null, listener + '|' + (data._id || (data.name + '|' + bits)));
      L(C_INFO, '     état : ' + etat());
      return;
    }

    if (listener === 'tip-latest') {
      var amt = num(data.amount, 0);
      L(C_TITLE, 'DON  ' + amt);
      if (amt <= 0) { L(C_SKIP, '     ignoré : montant nul'); return; }
      var secDon = amt * F.secPerTipUnit;
      addTime(secDon);
      addPoints(amt * F.ptsPerTipUnit);
      creditMini('tips', 1, secDon, null, listener + '|' + (data._id || (data.name + '|' + amt)));
      L(C_INFO, '     état : ' + etat());
      return;
    }

    if (listener === 'follower-latest') {
      var qui = String(data.name || data.displayName || '').toLowerCase();
      L(C_TITLE, 'FOLLOW  ' + (qui || '?'));

      /* Un follow est gratuit et illimite : c-est le seul event du subathon
         qu-un viewer peut declencher a volonte, en se desabonnant et en
         resuivant. Deux garde-fous : on ne compte qu-une fois par personne,
         et on peut plafonner le total par heure. */
      if (qui) {
        if (followsVus.indexOf(qui) > -1) {
          L(C_SKIP, '     ignoré : « ' + qui + ' » a déjà été compté (unfollow/refollow)');
          return;
        }
        followsVus.push(qui);
        if (followsVus.length > 3000) followsVus.shift();
      }

      var plafond = num(F.followsMaxPerHour, 0);
      if (plafond > 0) {
        var ilYaUneHeure = Date.now() - 3600000, fi;
        for (fi = followsRecents.length - 1; fi >= 0; fi--) {
          if (followsRecents[fi] < ilYaUneHeure) followsRecents.splice(fi, 1);
        }
        if (followsRecents.length >= plafond) {
          L(C_SKIP, '     ignoré : plafond de ' + plafond + ' follows par heure atteint');
          return;
        }
        followsRecents.push(Date.now());
      }

      var secFollow = num(F.secPerFollow, 0);
      if (secFollow <= 0 && num(F.ptsPerFollow, 0) <= 0) {
        L(C_SKIP, '     ignoré : les follows ne rapportent rien (réglage à 0)');
        return;
      }
      L(C_INFO, '     ' + Math.round(secFollow) + ' s et ' + num(F.ptsPerFollow, 0) + ' pt');
      addTime(secFollow);
      addPoints(num(F.ptsPerFollow, 0));
      creditMini('follows', 1, secFollow, null, listener + '|' + (data._id || ('follow|' + qui)), false);
      L(C_INFO, '     état : ' + etat());
      return;
    }

    if (listener === 'message') {
      if (F.commandsEnabled === 'on') command(data);
      return;
    }

    if (listener === 'kvstore:update') {
      var kv = data.data || data;
      if (F.instanceSync !== 'off' && kv && kv.key &&
          String(kv.key).indexOf(F.storeKey) > -1) adopterEtat(kv.value);
      return;
    }

    L(C_SKIP, 'non traité : « ' + listener + ' » (ce type d\'event n\'agit pas sur le subathon)');
  }

  /* ---------------------------------------------------------
     Commandes chat (modérateurs + streamer)
     --------------------------------------------------------- */
  /* Format STRICT hh:mm:ss, pour le champ de l-editeur uniquement.

     L-editeur applique les champs a chaque frappe : une valeur incomplete
     comme « 6 » serait sinon appliquee comme 6 secondes avant que la
     streameuse ait fini de taper « 06:30:00 ». On n-accepte donc que la
     forme complete, celle-la meme qu-affiche le chrono. Tout le reste est
     considere comme une saisie en cours et purement ignore.

     Retourne le nombre de secondes, ou null si la saisie n-est pas encore
     complete. */
  function parseStrict(s) {
    var m = String(s || '').trim().match(/^(\d{1,3}):([0-5]?\d):([0-5]?\d)$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
  }

  /* Format SOUPLE, pour les commandes de chat : un message arrive d-un bloc,
     jamais caractere par caractere. On accepte donc hh:mm:ss, hh:mm, et les
     ecritures a unites — 3h30, 90m, 45s. */
  function parseSouple(s) {
    s = String(s || '').trim();
    // le signe est traite par l-appelant : on l-ecarte avant d-analyser,
    // sinon « +01:00:00 » ne serait pas reconnu comme une duree hh:mm:ss
    s = s.replace(/^[+-]/, '');
    var m = s.match(/^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/);
    if (m) {
      return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 +
             (m[3] ? parseInt(m[3], 10) : 0);
    }
    return parseDur(s);
  }

  function parseDur(s) {
    s = String(s || '').trim().toLowerCase();
    var re = /(\d+(?:[.,]\d+)?)\s*(h|m|s)?/g, m, total = 0, found = false;
    var precedent = null;
    while ((m = re.exec(s)) !== null) {
      found = true;
      var v = parseFloat(m[1].replace(',', '.'));
      var u = m[2];
      /* Un nombre sans unite prend l-unite immediatement inferieure a celle
         qui precede : « 3h30 » vaut 3 h 30 min, « 1h30m20 » ajoute 20 s.
         Sans cela, le 30 de « 3h30 » serait lu en secondes — or c-est
         l-ecriture naturelle, celle que l-on tape spontanement. */
      if (!u) {
        u = precedent === 'h' ? 'm' : precedent === 'm' ? 's' : 's';
      }
      total += v * (u === 'h' ? 3600 : u === 'm' ? 60 : 1);
      precedent = u;
    }
    return found ? total : null;
  }
  function command(ev) {
    var d = ev.data || ev;
    var text = String(d.text || '').trim();
    if (text.charAt(0) !== '!') return;

    var tags = d.tags || {};
    var badges = String(tags.badges || '');
    var pseudo = String(d.nick || d.displayName || d.username || '').toLowerCase();

    /* Par defaut, SEULE la proprietaire de la chaine commande le subathon.
       On la reconnait a son badge de diffuseur ou a son pseudo, qui est
       toujours identique au nom de la chaine sur Twitch. Les moderateurs
       n-ont aucun pouvoir sauf si le champ le prevoit explicitement. */
    var proprietaire = badges.indexOf('broadcaster') > -1 ||
                       (CHAINE !== '' && pseudo === CHAINE);
    var moderateur = tags.mod === '1' || tags.mod === 1 ||
                     badges.indexOf('moderator') > -1;

    var autorise = proprietaire ||
                   (F.commandsWho === 'ownerAndMods' && moderateur);
    if (!autorise) {
      L(C_WARN, 'commande refusée : « ' + text +' » de ' + (pseudo || 'inconnu') +
                ' — réservée à ' + (F.commandsWho === 'ownerAndMods'
                                    ? 'la streameuse et ses modérateurs'
                                    : 'la streameuse'));
      return;
    }

    executer(text);
  }

  /* Corps des commandes, SANS controle de droits. Deux appelants :
     - command(), qui a deja verifie que l-emetteur a le droit ;
     - SUBATHON.cmd(), depuis la console — y avoir acces suppose deja un acces
       a la machine, il n-y a donc rien de plus a verifier.
     Un seul chemin pour les deux, donc un seul comportement a maintenir. */
  function executer(text) {
    text = String(text || '').trim();
    if (text.charAt(0) !== '!') text = '!' + text;

    var p = text.split(/\s+/);
    var cmd = p[0].toLowerCase();

    // raccourcis : plus courts a taper a 4 h du matin
    if (cmd === '!pause')  { L(C_TITLE, 'commande : mise en pause'); return setPaused(true); }
    if (cmd === '!resume' || cmd === '!reprendre') {
      L(C_TITLE, 'commande : reprise'); return setPaused(false);
    }

    if (cmd === '!timer') {
      var sub = (p[1] || '').toLowerCase();
      if (sub === 'pause')  return setPaused(true);
      if (sub === 'resume' || sub === 'start') return setPaused(false);
      if (sub === 'set')    {
        var v = parseSouple(p.slice(2).join(''));
        if (v !== null) { setTime(v); L(C_TITLE, 'commande : temps réglé sur ' + fmt(v * 1000)); }
        else L(C_WARN, 'temps illisible. Exemples : 06:30:00, 3h30, 90m');
        return;
      }
      var raw = p.slice(1).join('');
      var sign = raw.charAt(0) === '-' ? -1 : 1;
      var dur = parseSouple(raw);
      if (dur !== null) addTime(sign * dur);
      return;
    }
    if (cmd === '!points') {
      var s2 = (p[1] || '').toLowerCase();
      if (s2 === 'set') {
        var cible = num(p[2], null);
        if (cible === null) { L(C_WARN, 'valeur illisible. Exemple : !points set 44'); return; }
        setPoints(cible);
        return;
      }
      var delta = num(p[1], 0);
      if (delta) addPoints(delta);
      else L(C_WARN, 'usage : !points set 44  (valeur absolue)  ou  !points -3  (ajout)');
      return;
    }
    if (cmd === '!subathon' && (p[1] || '').toLowerCase() === 'reset') {
      toutReinitialiser();
      L(C_TITLE, 'commande : subathon réinitialisé');
    }
  }

  /* ---------------------------------------------------------
     Simulation — utilisée par le panneau de test ET par le harness
     Les payloads reproduisent exactement ceux de StreamElements,
     gift bomb comprise (récap + events individuels).
     --------------------------------------------------------- */
  function emit(listener, payload) {
    // _id unique : deux clics identiques sur le panneau de test doivent bien
    // compter deux fois, sans quoi la simulation deviendrait trompeuse
    payload._id = 'sim_' + (++simSeq);
    window.dispatchEvent(new CustomEvent('onEventReceived', {
      detail: { listener: listener, event: payload }
    }));
  }
  var sim = {
    sub: function (tier, months, name) {
      emit('subscriber-latest', {
        name: name || 'TestViewer', amount: months || 1, tier: tier || '1000',
        gifted: false, message: 'test sub'
      });
    },
    gift: function (tier, sender) {
      emit('subscriber-latest', {
        name: 'LuckyViewer', sender: sender || 'Gifter', amount: 1,
        tier: tier || '1000', gifted: true, bulkGifted: false, isCommunityGift: false
      });
    },
    giftbomb: function (count, tier, sender) {
      count = count || 5; tier = tier || '1000'; sender = sender || 'BigGifter';
      emit('subscriber-latest', {
        name: sender, sender: sender, amount: count, tier: tier,
        gifted: true, bulkGifted: true, isCommunityGift: false
      });
      for (var i = 0; i < count; i++) {
        emit('subscriber-latest', {
          name: 'Gifted_' + (i + 1), sender: sender, amount: 1, tier: tier,
          gifted: true, bulkGifted: false, isCommunityGift: true
        });
      }
    },
    follow: function (name) {
      emit('follower-latest', { name: name || ('Follower_' + Math.floor(Math.random() * 99999)) });
    },
    cheer: function (bits, name) {
      emit('cheer-latest', { name: name || 'Cheerer', amount: bits || 100, message: 'cheer!' });
    },
    tip: function (amount) {
      emit('tip-latest', { name: 'Tipper', amount: amount || 5, currency: 'EUR', message: '' });
    },
    chaos: function (n) {
      n = n || 12;
      for (var i = 0; i < n; i++) {
        (function (i) {
          setTimeout(function () {
            var r = Math.random();
            if (r < .35) sim.sub(['1000', '2000', '3000', 'prime'][i % 4], 1 + (i % 12));
            else if (r < .6) sim.gift();
            else if (r < .8) sim.giftbomb(1 + Math.floor(Math.random() * 8));
            else sim.cheer([100, 500, 1000, 5000][i % 4]);
          }, i * 220);
        })(i);
      }
    }
  };

  /* ---------------------------------------------------------
     Panneau de test intégré (field "Mode test")
     --------------------------------------------------------- */
  function buildDebug() {
    if (document.getElementById('sb-debug')) return;
    var box = document.createElement('div');
    box.id = 'sb-debug';
    box.className = 'sb-debug';
    box.innerHTML =
      '<h4>Mode test</h4>' +
      '<div class="sb-row" data-g="subs"></div>' +
      '<div class="sb-row" data-g="gifts"></div>' +
      '<div class="sb-row" data-g="bits"></div>' +
      '<div class="sb-row" data-g="ctrl"></div>' +
      '<div class="sb-out" id="sb-dbg-out"></div>';
    document.body.appendChild(box);

    var mk = function (group, label, fn, cls) {
      var b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.onclick = fn;
      box.querySelector('[data-g="' + group + '"]').appendChild(b);
    };
    mk('subs', 'T1',    function () { sim.sub('1000'); });
    mk('subs', 'T2',    function () { sim.sub('2000'); });
    mk('subs', 'T3',    function () { sim.sub('3000'); });
    mk('subs', 'Prime', function () { sim.sub('prime'); });
    mk('subs', 'Resub 24m', function () { sim.sub('1000', 24); });

    mk('gifts', 'Gift x1',  function () { sim.gift(); });
    mk('gifts', 'Bomb x5',  function () { sim.giftbomb(5); });
    mk('gifts', 'Bomb x25', function () { sim.giftbomb(25); });

    mk('bits', '100 bits',  function () { sim.cheer(100); });
    mk('bits', '1k bits',   function () { sim.cheer(1000); });
    mk('bits', '10k bits',  function () { sim.cheer(10000); });
    mk('bits', 'Tip 5',     function () { sim.tip(5); });
    mk('bits', 'Follow',    function () { sim.follow(); });

    mk('ctrl', '+1 min', function () { addTime(60); });
    mk('ctrl', '-1 min', function () { addTime(-60); });
    mk('ctrl', 'Pause',  function () { setPaused(!S.paused); });
    mk('ctrl', 'Chaos',  function () { sim.chaos(14); });
    mk('ctrl', 'Reset',  function () { toutReinitialiser(); }, 'sb-warn');

    setInterval(function () {
      var o = document.getElementById('sb-dbg-out');
      if (o) o.textContent = 'points ' + Math.round(S.points) +
        ' · fenêtre ' + S.windowStart + ' · ' + (S.paused ? 'pause' : 'run');
    }, 400);
  }

  /* ---------------------------------------------------------
     Application des Fields
     --------------------------------------------------------- */
  function loadFont(name) {
    if (!name) return;
    var id = 'sb-font-link', l = document.getElementById(id);
    if (!l) { l = document.createElement('link'); l.id = id; l.rel = 'stylesheet'; document.head.appendChild(l); }
    l.href = 'https://fonts.googleapis.com/css2?family=' +
             encodeURIComponent(name).replace(/%20/g, '+') +
             ':wght@400;500;600;700&display=swap';
    el.root.style.setProperty('--font', "'" + name + "', 'Fredoka', sans-serif");

    /* Les largeurs de texte changent quand la police arrive : sans ce
       reajustement, un libelle mesure avec la police de secours garde une
       taille inadaptee. */
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () {
        Object.keys(rows).forEach(function (k) { if (rows[k]) fitLabel(rows[k]); });
      })['catch'](function () {});
    }
  }
  /* Orientation de la fronde du coin haut-gauche. Chaque transformation depose
     la tige a une hauteur differente : `dy` la ramene sur le lisere. */
  var TL_MODES = {
    rot180:  { t: 'rotate(180 60 60)',            dy: 0   },
    mirrorh: { t: 'translate(120,0) scale(-1,1)', dy: -12 },
    mirrorv: { t: 'translate(0,120) scale(1,-1)', dy: 0   },
    none:    { t: '',                             dy: -12 }
  };
  function applyTlOrientation() {
    var m = TL_MODES[F.tlOrientation] || TL_MODES.rot180;
    var g = document.getElementById('sb-tl-flip');
    if (g) g.setAttribute('transform', m.t);
    el.root.style.setProperty('--tl-dy', (m.dy * F.foliageSize / 120).toFixed(1) + 'px');
  }

  function hexToRgb(h) {
    h = String(h || '').trim();
    var m = h.match(/rgba?\(([^)]+)\)/i);          // SE peut renvoyer rgb()/rgba()
    if (m) return m[1].split(',').slice(0, 3).map(function (v) {
      return Math.round(parseFloat(v)) || 0;
    }).join(',');
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return '255,251,243';
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
  }
  function applyFields(fd) {
    /* Une valeur vide est normalement ignoree : cela evite qu-un champ non
       renseigne dans StreamElements ecrase un defaut utile. Mais le champ de
       temps DOIT pouvoir redevenir vide — c-est ce que fait `setField` apres
       execution, et c-est ce qui libere le verrou. Sans cette exception, le
       widget continuait de voir l-ancienne valeur et refusait de rejouer la
       meme demande. */
    var VIDABLES = { setTimeTo: 1 };
    for (var key in D) {
      if (!fd || fd[key] === undefined) continue;
      if (fd[key] === '' && !VIDABLES[key]) continue;
      F[key] = fd[key];
    }
    ['scale','startHours','startMinutes','maxHours','beatSeconds','secSubT1','secSubT2','secSubT3',
     'secSubPrime','giftTimeFactor','secPer100Bits','secPerTipUnit','secPerFollow','followsMaxPerHour','ptsSubT1','ptsSubT2',
     'ptsSubT3','ptsSubPrime','giftPointsFactor','ptsPer100Bits','ptsPerTipUnit','ptsPerFollow',
     'goalsVisible','goalFontSize','goalsKeepDone','rotateDelay','alertDuration','miniDuration','alertBgOpacity',
     'glowOpacity','glowSize','foliageSize','windAmp','windBob','windSpeed'
    ].forEach(function (n) { F[n] = num(F[n], D[n]); });

    var s = el.root.style;
    s.setProperty('--scale', F.scale);
    s.setProperty('--goal-font', F.goalFontSize + 'px');
    s.setProperty('--cream', F.creamColor);
    s.setProperty('--olive', F.oliveColor);
    s.setProperty('--leaf-1', F.leaf1Color);
    s.setProperty('--leaf-2', F.leaf2Color);
    s.setProperty('--leaf-3', F.leaf3Color);
    s.setProperty('--stem', F.leaf2Color);
    s.setProperty('--alert-bg', hexToRgb(F.alertBgColor));
    // un seul reglage pilote le fond : la classe retire aussi le retrait droit
    // de la pilule, sans quoi le texte flotterait a droite dans le vide
    s.setProperty('--alert-bg-a', F.alertBgOpacity / 100);
    el.alert.classList.toggle('sb-alert--nobg', F.alertBackground === 'off');
    s.setProperty('--alert-ink', F.alertTextColor);
    s.setProperty('--glow', F.glowColor);
    s.setProperty('--glow-rgb', hexToRgb(F.glowColor));
    s.setProperty('--glow-a', F.glowOpacity / 100);
    s.setProperty('--glow-size', F.glowSize + 'px');
    s.setProperty('--foliage-size', F.foliageSize + 'px');
    s.setProperty('--wind-amp', (F.windAmp / 100 * 2.6).toFixed(2) + 'deg');
    s.setProperty('--wind-bob', (F.windBob / 100 * 3.4).toFixed(2) + 'px');
    s.setProperty('--wind-dur', (5.2 - F.windSpeed / 100 * 3).toFixed(2) + 's');
    loadFont(F.fontFamily);

    applyTlOrientation();
    goals = parseGoals(F.goalsList);
    el.alertText.textContent = F.alertText;
  }

  /* ---------------------------------------------------------
     Démarrage
     --------------------------------------------------------- */
  /* Plusieurs instances du widget peuvent tourner en meme temps — l-editeur
     StreamElements et la source OBS, par exemple — et elles partagent la meme
     sauvegarde. Sans cela, chacune garde son compteur en memoire et il faut
     rafraichir pour les remettre d-accord. On ecoute donc `kvstore:update`,
     que StreamElements emet a chaque ecriture, pour adopter l-etat a chaud. */
  function adopterEtat(v) {
    if (!v || typeof v !== 'object' || typeof v.endsAt !== 'number') return;
    if (v.by === INSTANCE) return;                    // echo de notre propre ecriture

    /* Enregistrement defensif anti-doublon. StreamElements livre le MEME
       event brut a chaque instance ouverte (Chrome, OBS, editeur) : si une
       autre instance l-a deja credite et que ce widget-ci le recoit a son
       tour un peu plus tard sur son propre socket, le filtre par _id de
       handle() doit deja le reconnaitre comme traite — sinon il le credite
       une seconde fois, et ce doublon regagne ensuite toutes les instances
       via la fusion au maximum. On enregistre donc l-identifiant de l-event
       synchronise AVANT toute autre logique, meme si rien d-autre ne change
       dans cet appel. Le format (listener + « | » + id) est le meme que
       celui pousse dans `seen` par handle(), donc les deux se recoupent. */
    /* On enregistre TOUT ce que l-autre instance a deja paye, avant toute
       autre logique. Sans cela, cette instance adopte un etat qui contient
       deja l-event, puis recoit l-event sur son propre socket et le credite
       une seconde fois : c-est la source du double comptage entre instances.

       Le registre porte les 40 derniers identifiants, et non le seul dernier
       event : si l-autre instance en a encaisse plusieurs avant que cette
       sauvegarde n-arrive, ils sont tous couverts. */
    var registre = (v.credited && v.credited.length) ? v.credited
                 : (v.miniLast && v.miniLast.id ? [String(v.miniLast.id)] : []);
    for (var ri = 0; ri < registre.length; ri++) {
      var idExterne = String(registre[ri]);
      if (seen.indexOf(idExterne) === -1) {
        seen.push(idExterne);
        if (seen.length > 120) seen.shift();
      }
      noterCredite(idExterne);
    }

    /* Pas de comparaison de numero de version entre instances : chacune
       incremente le sien de son cote, ils ne sont pas comparables. On fusionne
       plutot au MAXIMUM, une operation qui donne le meme resultat quel que soit
       l-ordre d-arrivee des messages. Un point acquis ne peut donc jamais se
       perdre, et une instance qui a rate des events rattrape automatiquement.

       Seule exception : les actions VOLONTAIRES — reset, pause, retrait de
       temps — portent une « epoque » superieure et s-imposent telles quelles,
       car elles doivent pouvoir faire redescendre le compteur. */
    var vEpoque = num(v.epoch, 0);
    var volontaire = vEpoque > num(S.epoch, 0);
    if (!volontaire && vEpoque < num(S.epoch, 0)) return;   // etat d-avant notre reset

    var avant = firstIncomplete();
    var pointsAvant = S.points, finAvant = S.endsAt, pauseAvant = S.paused;
    var fenetreAvant = S.windowStart;

    if (volontaire) {
      S.endsAt      = v.endsAt;
      S.paused      = !!v.paused;
      S.pauseRemain = num(v.pauseRemain, 0);
      S.points      = num(v.points, 0);
      S.windowStart = num(v.windowStart, 0);
      S.epoch       = vEpoque;
    } else {
      S.points      = Math.max(S.points, num(v.points, 0));
      S.endsAt      = Math.max(S.endsAt, v.endsAt);
      S.windowStart = Math.max(S.windowStart, num(v.windowStart, 0));
    }

    var change = S.points !== pointsAvant || S.endsAt !== finAvant ||
                 S.paused !== pauseAvant || S.windowStart !== fenetreAvant;
    var enAvance = !volontaire &&
                   (S.points > num(v.points, 0) || S.endsAt > v.endsAt);

    if (change) {
      var apres = firstIncomplete();
      rafraichirPause();
      paintTimer();
      syncGoals(false);
      for (var i = avant; i < apres && i < goals.length; i++) {
        L(C_TITLE, '     ✔ OBJECTIF ATTEINT : « ' + goals[i].label +
                   ' » (' + goals[i].value + ')');
        pushAlert(String(F.alertText).replace(/\{goal\}/gi, goals[i].label));
      }
      /* Defilement des fournees. On ne peut PAS se contenter de `apres > avant` :
         quand une instance recoit des points par synchronisation, les objectifs
         sont deja comptes comme atteints des la recopie de S.points, donc les
         deux valeurs sont egales et le defilement ne serait jamais programme.
         On verifie donc directement si la fenetre doit bouger. */
      if (apres > avant || targetWindowStart() !== S.windowStart ||
          num(v.windowStart, 0) !== fenetreAvant) scheduleRotate(true);
      // Cette instance n-a pas recu l-event : elle affiche le gain sans en
      // connaitre l-origine. Si elle l-avait recu, les valeurs seraient deja
      // egales et on ne passerait pas ici — donc aucun doublon possible.
      if (!volontaire && S.endsAt > finAvant + 1000) {
        var ml = v.miniLast;
        if (ml && ml.id && String(ml.id) !== dernierMiniId) {
          dernierMiniId = String(ml.id);
          miniDepuis(ml);                       // détail complet
        } else if (!ml) {
          miniBrut((S.endsAt - finAvant) / 1000);   // sauvegarde d'une ancienne version
        }
      }
      L(C_INFO, (volontaire ? 'état imposé par une autre instance : '
                            : 'état rattrapé sur une autre instance : ') + etat());
    }
    // en avance : on republie pour que l-autre instance nous rattrape
    if (enAvance) save();
  }

  /* ---------------------------------------------------------
     Actions pilotées depuis les Fields StreamElements.

     StreamElements n-offre pas de bouton : on detourne donc une liste
     deroulante et un champ texte. Chaque action est executee UNE FOIS puis
     neutralisee, sinon un simple rechargement de page la rejouerait — un
     reset accidentel en plein subathon serait catastrophique.

     La neutralisation passe par la sauvegarde partagee : on y note la
     signature de la derniere action jouee. Toutes les instances la voient,
     donc une action n-est executee qu-une fois meme avec plusieurs onglets
     ouverts, et elle ne se rejoue pas au redemarrage d-OBS.
     --------------------------------------------------------- */
  /* Bandeau d-etat affiche sur le widget lui-meme. Il repond a la seule
     question que pose le selecteur bloque : « est-ce que mon action est
     encore active ? ». Visible uniquement dans l-editeur et en mode test,
     jamais a l-antenne. */
  var champsRemisAZero = false, texteVu = null, sigEnCours = null,
      sigDepuis = 0, bandeauTimer = null, verrouAction = '', verrouTemps = '';

  function montrerBandeau(acte, brut, dejaFait) {
    // Uniquement en Mode test. L-editeur ne suffit pas comme critere : la
    // preview est elle aussi en mode editeur, et le bandeau y resterait
    // affiche en permanence.
    if (F.debugPanel !== 'on') return;
    var b = document.getElementById('sb-action-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'sb-action-banner';
      b.className = 'sb-banner';
      document.body.appendChild(b);
    }
    var noms = { pause: 'Chrono mis en pause', resume: 'Chrono relancé',
                 reset: 'Subathon remis à zéro', none: '' };
    var quoi = [];
    if (noms[acte]) quoi.push(noms[acte]);
    if (brut) quoi.push('Temps réglé sur ' + brut);
    if (!quoi.length) return;

    /* Le conseil doit designer le bon champ : parler du « menu » alors que
       seul le champ de temps a servi serait deroutant. */
    var ouAgir;
    if (acte !== 'none' && brut)  ouAgir = 'le menu sur « Aucune » et videz le champ de temps';
    else if (acte !== 'none')     ouAgir = 'le menu sur « Aucune »';
    else                          ouAgir = 'le champ de temps vide';

    var quoiSuit = (acte !== 'none' && brut) ? 'vos derniers réglages'
                 : (acte !== 'none') ? 'votre dernier choix' : 'votre dernière saisie';

    clearTimeout(bandeauTimer);
    bandeauTimer = setTimeout(function () {
      var e = document.getElementById('sb-action-banner');
      if (e && e.parentNode) e.parentNode.removeChild(e);
    }, dejaFait ? 6000 : 10000);

    b.className = 'sb-banner' + (dejaFait ? ' sb-banner--done' : ' sb-banner--fresh');
    b.innerHTML = (dejaFait ? '✓ ' : '● ') + quoi.join(' · ') +
      '<br><small>' + (dejaFait
        ? 'Déjà fait. L\'écran affiche encore ' + quoiSuit + ', mais ça n\'agit plus.'
        : (champsRemisAZero
            ? 'C\'est fait. Les réglages sont revenus à leur état neutre — ' +
              'enregistrez pour le conserver.'
            : 'C\'est fait. Remettez ' + ouAgir + '.')) + '</small>';
  }

  /* `getOverlayStatus()` retourne une PROMESSE : la lire comme un objet
     renvoyait toujours faux, et tout ce qui depend du mode editeur restait
     inactif. On resout donc la promesse une fois au demarrage et on garde le
     resultat. La forme synchrone est acceptee en repli, certaines versions
     de StreamElements l-ayant exposee ainsi. */
  var modeEditeur = null;

  function detecterEditeur(apres) {
    if (typeof SE_API === 'undefined' || !SE_API.getOverlayStatus) {
      modeEditeur = false; return apres && apres();
    }
    try {
      var r = SE_API.getOverlayStatus();
      if (r && typeof r.then === 'function') {
        r.then(function (st) {
          modeEditeur = !!(st && st.isEditorMode);
          if (apres) apres();
        })['catch'](function () { modeEditeur = false; if (apres) apres(); });
      } else {
        modeEditeur = !!(r && r.isEditorMode);
        if (apres) apres();
      }
    } catch (e) { modeEditeur = false; if (apres) apres(); }
  }

  function estEditeur() { return modeEditeur === true; }

  /* Le champ de temps se tape caractere par caractere, et l-editeur applique
     a la volee : sans attente, « 3h30 » declencherait quatre actions et le
     champ serait vide des la premiere frappe. On laisse donc passer une
     seconde et demie de silence avant d-agir.
     Le menu deroulant, lui, n-a pas d-etat intermediaire : il agit tout de
     suite. */
  var attenteSaisie = null;

  function appliquerAction() {
    var brut = String(F.setTimeTo || '').trim();
    var acte = F.action || 'none';

    /* Chaque champ libere SON propre verrou en revenant a l-etat neutre, sans
       dependre de l-autre : vider le champ de temps doit permettre de retaper
       la meme valeur, meme si le menu est reste sur une action. Sans ce
       decouplage, choisir « reset » une seconde fois — ou retaper le meme
       temps — ne faisait rien. */
    /* Chaque champ libere SON verrou des qu-il revient a l-etat neutre. Comme
       `setField` le vide automatiquement apres execution, retaper la meme
       valeur passe forcement par cet etat neutre : la demande suivante est
       donc toujours honoree. */
    if (acte === 'none') verrouAction = '';
    if (!brut) verrouTemps = '';
    if (acte === 'none' && !brut) {
      /* La liberation doit etre ENREGISTREE, pas seulement gardee en memoire :
         l-editeur StreamElements recharge entierement la page a chaque
         changement de champ. Sans cette sauvegarde, le widget relisait
         l-ancien « reset » depuis le magasin au chargement suivant et
         refusait de le rejouer — il fallait passer par une autre action pour
         changer la signature. */
      if (S.lastAction) {
        S.lastAction = '';
        save();
      }
      sigEnCours = null;
      texteVu = null;
      return;
    }

    /* Plus aucune temporisation : une saisie incomplete est simplement
       ignoree, ce qui rend le mecanisme insensible a la vitesse de frappe. */
    if (brut && parseStrict(brut) === null) {
      if (brut !== texteVu) {
        texteVu = brut;
        L(C_SKIP, 'saisie en cours : « ' + brut + ' » — format attendu hh:mm:ss, ' +
                  'par exemple 06:30:00');
      }
      brut = '';
      if (acte === 'none') return;
    }
    texteVu = brut;

    /* Garde-fou immediat, en memoire. La sauvegarde de S.lastAction est
       differee de 350 ms, or `setField` provoque aussitot un nouveau
       chargement des champs : sans ce verrou en memoire, l-action serait
       rejouee avant meme d-avoir ete enregistree. */
    /* Verrou anti-rejeu immediat. Il ne dure que le temps d-un cycle de
       chargement : sans cette expiration, revenir sur une action deja jouee
       plus tot dans la session resterait bloque — c-est ce qui empechait un
       « reset » de repartir apres etre passe par « pause » puis revenu. */
    var sig = (acte || 'none') + '|' + brut;
    if (sigEnCours === sig && Date.now() - sigDepuis < 2000) return;
    sigEnCours = sig;
    sigDepuis = Date.now();

    executerAction(brut);
  }

  function executerAction(brutValide) {
    var brut = brutValide !== undefined ? brutValide : String(F.setTimeTo || '').trim();
    var acte = F.action || 'none';
    if (acte === 'none' && !brut) return;

    // signature : identique tant que les champs ne changent pas
    var sig = acte + '|' + brut;
    // dejaJoue : vrai seulement si CHAQUE partie a deja ete jouee telle quelle
    /* Une action n-est « deja jouee » que si TOUT ce qu-elle demande a deja
       ete joue, ET qu-il y a bien quelque chose a jouer. Le cas piege : menu
       sur « Aucune » et temps retape a l-identique — la premiere condition
       est vraie par defaut, il faut donc verifier que le temps l-est aussi
       explicitement, et qu-il n-a pas ete libere entre-temps. */
    /* Une action n-est « deja jouee » que si elle est identique a la
       precedente ET que rien n-a ete relache entre-temps. `setField` vide le
       champ apres coup : retaper la meme valeur produit donc une VRAIE
       nouvelle demande, qu-il faut honorer. */
    var actionDejaJouee = (acte === 'none') || (verrouAction === acte);
    var tempsDejaJoue   = (!brut) || (verrouTemps === brut);
    var dejaJoue = actionDejaJouee && tempsDejaJoue;
    if (dejaJoue) {
      /* Un widget StreamElements ne peut pas modifier ses propres Fields : le
         selecteur reste donc affiche sur la derniere action choisie. On ne
         peut pas remettre l-interface a zero, mais on peut le DIRE clairement
         — a la fois dans la console et sur le widget lui-meme. */
      L(C_SKIP, 'action déjà appliquée, sans effet. Le sélecteur reste affiché : c\'est ' +
                'normal, un widget ne peut pas se remettre à zéro tout seul. Pour la ' +
                'rejouer, repassez sur « Aucune », enregistrez, puis choisissez de nouveau.');
      montrerBandeau(acte, brut, true);
      return;
    }
    S.lastAction = sig;
    if (acte !== 'none') verrouAction = acte;
    if (brut) verrouTemps = brut;


    /* Remise a zero des champs eux-memes. `SE_API.setField` ne fonctionne que
       dans l-editeur et n-enregistre pas : la streameuse voit le menu revenir
       sur « Aucune » et doit enregistrer pour figer. Le troisieme parametre a
       false empeche le rechargement de l-overlay, qui rejouerait le cycle.
       Hors editeur, la fonction est sans effet : le garde-fou par signature
       reste donc la vraie protection. */
    try {
      if (typeof SE_API !== 'undefined' && SE_API.setField && estEditeur()) {
        /* Vider un champ declenche un nouveau chargement, donc un nouveau
           passage ici avec une signature differente. On ne remet a zero que
           les champs qui ne le sont pas deja : sans cela, le vidage se
           declencherait une seconde fois pour rien. */
        if (acte !== 'none') SE_API.setField('action', 'none', false);
        if (brut && String(F.setTimeTo || '').trim() !== '') {
          SE_API.setField('setTimeTo', '', false);
        }
        champsRemisAZero = true;

        /* Les champs viennent d-etre ramenes a leur etat neutre : le verrou
           n-a plus lieu d-etre, puisqu-un rechargement ne relira plus
           d-action a jouer. On le libere donc, sans quoi il faudrait
           repasser MANUELLEMENT par « Aucune » avant chaque nouvelle
           utilisation.
           Sans danger pour la production : `setField` ne fonctionne que dans
           l-editeur, donc dans OBS le verrou reste entier et un « reset »
           oublie dans les reglages ne se rejouera jamais. */
        S.lastAction = '';
        verrouAction = '';
        verrouTemps = '';
        sigEnCours = null;
        texteVu = null;
        save();
      }
    } catch (e) { champsRemisAZero = false; }

    montrerBandeau(acte, brut, false);

    if (brut) {
      var v = parseStrict(brut);
      if (v === null) {
        L(C_WARN, 'format attendu hh:mm:ss, par exemple 06:30:00');
      } else {
        setTime(v);
        L(C_TITLE, 'ACTION : temps restant réglé sur ' + fmt(v * 1000));
      }
    }

    if (acte === 'pause')      { setPaused(true);  L(C_TITLE, 'ACTION : mise en pause'); }
    else if (acte === 'resume'){ setPaused(false); L(C_TITLE, 'ACTION : reprise'); }
    else if (acte === 'reset') {
      toutReinitialiser();
      L(C_TITLE, 'ACTION : subathon réinitialisé — départ à ' +
                 F.startHours + ' h ' + F.startMinutes);
    }
    save();
  }

  function boot(fieldData) {
    if (initStarted) {
      /* Rechargement a chaud : l-editeur reapplique les champs a chaque
         frappe. Il faut relancer l-action, sinon toute saisie posterieure au
         premier chargement serait ignoree. */
      applyFields(fieldData);
      syncGoals(true);
      appliquerAction();
      return;
    }
    initStarted = true;

    el.root      = $('#sb-root');
    el.alert     = $('#sb-alert');
    el.alertText = $('#sb-alert-text');
    el.timer     = $('#sb-timer');
    el.counter   = $('#sb-counter');
    el.goals     = $('#sb-goals');
    el.mini      = $('#sb-mini');
    if (!el.root) return;

    el.alert.classList.add('sb-alert--reserve');
    applyFields(fieldData);

    loadState(function (stored) {
      if (stored) {
        S.endsAt      = stored.endsAt || 0;
        S.paused      = !!stored.paused;
        S.pauseRemain = stored.pauseRemain || 0;
        S.points      = num(stored.points, 0);
        S.windowStart = num(stored.windowStart, 0);
        S.rev         = num(stored.rev, 0);
        S.epoch       = num(stored.epoch, 0);
        S.lastAction  = stored.lastAction || '';
        // au redemarrage, les champs encore remplis sont consideres comme
        // deja joues : c-est ce qui empeche un « reset » oublie de se rejouer
        /* Les verrous reprennent l-etat sauvegarde : un « reset » encore
           present dans les champs au redemarrage d-OBS ne doit pas se
           rejouer. En session, ce sont les liberations plus haut qui font
           foi — elles s-executent apres cette restauration. */
        if (S.lastAction) {
          var parts = String(S.lastAction).split('|');
          verrouAction = parts[0] === 'none' ? '' : parts[0];
          verrouTemps = parts[1] || '';
        }

        /* Le widget n-a pas tourne pendant un moment : on restitue le temps
           restant tel qu-il etait au dernier battement, comme si le chrono
           avait ete en pause. Le seuil evite de declencher sur un simple
           rechargement de page, qui ne prend qu-une poignee de secondes. */
        var battement = num(stored.beat, 0);
        var seuil = Math.max(20, num(F.beatSeconds, 30) * 2.5) * 1000;
        if (F.offlineBehaviour !== 'run' && !S.paused && battement > 0) {
          var absence = Date.now() - battement;
          var restantAlors = stored.endsAt - battement;
          if (absence > seuil && restantAlors > 0) {
            S.endsAt = Date.now() + restantAlors;
            L(C_TITLE, 'absence de ' + fmt(absence) + ' détectée — chrono repris à ' +
                       fmt(restantAlors) + ', ce temps n\'a pas été décompté');
          }
        }
      } else {
        S.endsAt = Date.now() + (F.startHours * 3600 + F.startMinutes * 60) * 1000;
      }
      S.booted = true;
      rafraichirPause();
      paintTimer();
      syncGoals(true);
      setInterval(function () { paintTimer(); tickAlert(); tickMini(); }, 250);

      /* Premiere sauvegarde tout de suite : sans elle, un redemarrage d-OBS
         survenu avant le premier battement — ou avant le premier event —
         retrouverait un magasin vide et repartirait de la duree initiale. */
      saveNow();

      // battement regulier, seulement si rien n-a ete ecrit entre-temps
      setInterval(function () {
        if (F.offlineBehaviour === 'run') return;
        if (Date.now() - derniereEcriture >= num(F.beatSeconds, 30) * 1000) save();
      }, 5000);
      // le mode editeur doit etre connu AVANT d-appliquer l-action :
      // c-est lui qui autorise la remise a zero des champs
      detecterEditeur(appliquerAction);
      if (F.debugPanel === 'on') buildDebug();
      L(C_TITLE, '═══ WIDGET PRÊT ═══');
      L(C_INFO, 'sauvegarde restaurée : ' + (stored ? 'OUI' : 'non (démarrage à neuf)') +
                ' · clé « ' + F.storeKey + ' »');
      L(C_INFO, 'objectifs chargés : ' + goals.length +
                ' · premier palier : ' + (goals[0] ? goals[0].value : '—'));
      L(C_INFO, 'temps par sub : T1 ' + F.secSubT1 + ' s · T2 ' + F.secSubT2 +
                ' s · T3 ' + F.secSubT3 + ' s · Prime ' + F.secSubPrime + ' s');
      L(C_INFO, 'points par sub : T1 ' + F.ptsSubT1 + ' · T2 ' + F.ptsSubT2 +
                ' · T3 ' + F.ptsSubT3 + ' · Prime ' + F.ptsSubPrime +
                ' · subs offerts ×' + F.giftPointsFactor);
      L(C_INFO, 'bits : ' + F.secPer100Bits + ' s et ' + F.ptsPer100Bits +
                ' pt par tranche de 100');
      L(C_INFO, 'follow : ' + F.secPerFollow + ' s et ' + F.ptsPerFollow + ' pt' +
                (num(F.followsMaxPerHour, 0) > 0
                  ? ' · plafond ' + F.followsMaxPerHour + '/h' : ' · sans plafond') +
                ' · un même viewer n\'est compté qu\'une fois');
      L(C_INFO, 'gift bombs : le recapitulatif est credite immediatement, les events individuels qui suivent sont absorbes');
      L(C_INFO, 'commandes chat : ' + (F.commandsEnabled === 'off' ? 'désactivées'
                : (F.commandsWho === 'ownerAndMods' ? 'streameuse + modérateurs'
                                                    : 'streameuse UNIQUEMENT')) +
                (CHAINE ? ' · chaîne « ' + CHAINE + ' »' : ''));
      L(C_INFO, 'coupures : ' + (F.offlineBehaviour === 'run'
                ? 'le chrono continue de tourner'
                : 'le chrono s\'arrête quand le widget ne tourne pas'));
      L(stored ? C_WARN : C_INFO, 'état de départ : ' + etat() +
        (stored && S.points > 0 ? '   ← points hérités de tests précédents, « !subathon reset » pour repartir de zéro' : ''));
    });
  }

  /* ---------------------------------------------------------
     Branchement StreamElements
     --------------------------------------------------------- */
  window.addEventListener('onWidgetLoad', function (obj) {
    var det = obj && obj.detail;
    if (det && det.channel && det.channel.username) {
      CHAINE = String(det.channel.username).toLowerCase();
    }
    boot((det && det.fieldData) || {});
  });

  window.addEventListener('onEventReceived', function (obj) {
    if (!obj.detail) return;
    var listener = obj.detail.listener;
    var data = obj.detail.event;
    if (!data) return;

    /* StreamElements livre CHAQUE event deux fois : une fois sous le listener
       generique « event » (ou « event:test » depuis l-emulateur) qui emballe
       le vrai message, une fois sous son listener propre. On ignore
       l-emballage et on ne traite que la livraison directe.

       C-est ce qui remplace l-ancien filtre par signature : plus besoin de
       deviner si deux payloads identiques sont un doublon, on ne recoit
       simplement plus le doublon. */
    if ((listener === 'event' || listener === 'event:test') && data.listener) {
      L(C_SKIP, 'emballage « ' + listener + ' » ignore (le message direct « ' +
                data.listener + ' » suit)');
      return;
    }
    var emballe = false;
    if (data.listener) { listener = data.listener; data = data.event || data; emballe = true; }

    if (listener !== 'message') {
      Lraw('◄ reçu  « ' + listener + ' »' +
           (emballe ? '  (emballage de test StreamElements)' : '  (event réel)') +
           '  — charge utile :', data);
    }

    if (data.itemId !== undefined) {
      L(C_SKIP, 'ignoré : achat boutique (itemId présent)');
      return;
    }

    handle(listener, data);
  });

  // API publique : console SE, harness local, ou overlay en direct.
  // @ts-ignore — propriété ajoutée volontairement à window ; TypeScript ne
  // connaît pas cette clé, mais StreamElements exécute du JavaScript pur.
  window.SUBATHON = {
    /* Toute commande chat, depuis la console. Le « ! » est facultatif.
         SUBATHON.cmd('points set 44')
         SUBATHON.cmd('timer set 05:36:00')
         SUBATHON.cmd('pause')
       Utile quand on n-a pas les droits sur le chat de la chaine. */
    cmd: executer,
    simulate: sim,
    addTime: addTime,
    setTime: setTime,
    setPaused: setPaused,
    addPoints: addPoints,
    setPoints: setPoints,
    state: function () { return S; },
    fields: function () { return F; },
    boot: boot
  };

  // hors StreamElements (test local ouvert directement), on démarre seul
  setTimeout(function () { if (!S.booted) boot({}); }, 700);
})();