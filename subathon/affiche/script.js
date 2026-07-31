(function () {


  var COLOR_VARS = {
    bgTintColor: '--bg-tint',
    accentLight: '--accent-light',
    accentDark: '--accent-dark',
    frameColor: '--frame-color',
    eyebrowColor: '--eyebrow-color',
    title1Top: '--title1-top',
    title1Bottom: '--title1-bottom',
    pillBg: '--pill-bg',
    pillBorder: '--pill-border',
    textColor: '--text-color'
  };

  var GOAL_COUNT = 40;
  function collectGoals(fieldData) {
    var goals = [];
    for (var i = 1; i <= GOAL_COUNT; i++) {
      var subs = fieldData['goal' + i + 'Subs'];
      var reward = fieldData['goal' + i + 'Reward'];
      if (subs === undefined || subs === '' || !reward) continue;
      goals.push({ subs: subs, reward: reward });
    }
    return goals;
  }

  function reportSize() {
    var root = document.getElementById('subathon-poster');
    if (!root) return;
    var h = Math.ceil(root.getBoundingClientRect().height);
    document.documentElement.style.height = h + 'px';
    document.body.style.height = h + 'px';
    document.body.style.margin = '0';
  }

  function positionStrikes() {
    var strikes = document.querySelectorAll('.goal-strike');
    for (var s = 0; s < strikes.length; s++) {
      var content = strikes[s].parentElement;
      var subsSpan = content.querySelector('.goal-subs');
      var rewardSpan = content.querySelector('.goal-reward');
      var contentRect = content.getBoundingClientRect();
      var subsRange = document.createRange();
      subsRange.selectNodeContents(subsSpan);
      var subsRect = subsRange.getBoundingClientRect();
      var rewardRect = rewardSpan.getBoundingClientRect();
      strikes[s].style.left = (subsRect.left - contentRect.left) + 'px';
      strikes[s].style.width = (rewardRect.right - subsRect.left) + 'px';
    }
  }

  function render(fieldData) {
    fieldData = fieldData || {};
    var root = document.getElementById('subathon-poster');
    var eyebrow = document.getElementById('eyebrow-text');
    var titleMain = document.getElementById('title-main');
    var titleAccent = document.getElementById('title-accent');
    var grid = document.getElementById('goals-grid');

    if (root) {
      Object.keys(COLOR_VARS).forEach(function (key) {
        if (fieldData[key]) root.style.setProperty(COLOR_VARS[key], fieldData[key]);
      });
      var tintOpacity = fieldData.bgTintOpacity;
      root.style.setProperty('--tint-opacity', (tintOpacity != null ? tintOpacity : 60) / 100);
    }

    var bgImageInner = document.getElementById('bg-image-inner');
    if (bgImageInner) {
      if (fieldData.bgImage) {
        var zoom = (Number(fieldData.bgZoom) || 100) / 100;
        var posX = fieldData.bgPosX != null ? fieldData.bgPosX : 50;
        var posY = fieldData.bgPosY != null ? fieldData.bgPosY : 50;
        bgImageInner.style.backgroundImage = "url('" + fieldData.bgImage + "')";
        bgImageInner.style.backgroundSize = fieldData.bgFit || 'cover';
        bgImageInner.style.backgroundPosition = posX + '% ' + posY + '%';
        bgImageInner.style.transform = 'scale(' + zoom + ')';
      } else {
        bgImageInner.style.backgroundImage = 'none';
      }
    }

    if (eyebrow) eyebrow.textContent = fieldData.eyebrow || 'SUBATHON';
    if (titleMain) titleMain.textContent = fieldData.titleLine1 || 'OBJECTIFS';
    if (titleAccent) titleAccent.textContent = fieldData.titleLine2 || 'DU SUBATHON';

    var goals = collectGoals(fieldData);
    if (grid) {
      grid.innerHTML = '';
      var currentSubs = Number(fieldData.currentSubs) || 0;
      goals.forEach(function (g) {
        var pill = document.createElement('div');
        pill.className = 'goal-pill';
        if (currentSubs >= Number(g.subs)) pill.className += ' is-done';
        var checkEl = document.createElement('span');
        checkEl.className = 'goal-check';
        checkEl.textContent = '✓';
        checkEl.style.fontFamily = "'Chakra Petch', sans-serif";
        var subsEl = document.createElement('span');
        subsEl.className = 'goal-subs';
        subsEl.textContent = g.subs;
        var rewardEl = document.createElement('span');
        rewardEl.className = 'goal-reward';
        rewardEl.textContent = g.reward;
        var contentEl = document.createElement('span');
        contentEl.className = 'goal-content';
        contentEl.appendChild(subsEl);
        contentEl.appendChild(rewardEl);
        if (currentSubs >= Number(g.subs)) {
          var strike = document.createElement('span');
          strike.className = 'goal-strike';
          contentEl.appendChild(strike);
        }
        pill.appendChild(checkEl);
        pill.appendChild(contentEl);
        grid.appendChild(pill);
      });
    }

    reportSize();
    positionStrikes();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        positionStrikes();
        reportSize();
      });
    }
  }

  window.addEventListener('onWidgetLoad', function (obj) {
    window['__SE_LOADED__'] = true;
    render(obj.detail && obj.detail.fieldData);
  });

  // Fallback render for local preview / testing outside StreamElements
  document.addEventListener('DOMContentLoaded', function () {
    if (!window['__SE_LOADED__']) render({});
  });
})();