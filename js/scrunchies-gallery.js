(function () {
  var grid = document.getElementById('scrunchies-gallery-grid');
  var select = document.getElementById('gallery-sort');
  var menu = document.getElementById('store-menu');
  if (!grid) return;

  var menuToggle = document.getElementById('store-menu-toggle');
  var menuClose = document.getElementById('store-menu-close');
  var menuBackdrop = document.getElementById('store-menu-backdrop');
  var empty = document.getElementById('gallery-filter-empty');
  var moreBtn = document.getElementById('gallery-more');

  var active = { type: [], color: [], country: [] };
  var filterButtons = menu ? menu.querySelectorAll('[data-gallery-filter]') : [];
  var clearBtn = menu ? menu.querySelector('[data-gallery-clear]') : null;
  var menuOpen = false;
  var drawerMq = window.matchMedia('(max-width: 768px)');

  function syncMenuInert() {
    if (!menu || !('inert' in menu)) return;
    menu.inert = drawerMq.matches && !menuOpen;
  }

  function openMenu() {
    if (!menu || menuOpen) return;
    menuOpen = true;
    menu.classList.add('is-open');
    if (menuBackdrop) menuBackdrop.hidden = false;
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('store-menu-open');
    syncMenuInert();
  }

  function closeMenu() {
    if (!menu || !menuOpen) return;
    menuOpen = false;
    menu.classList.remove('is-open');
    if (menuBackdrop) menuBackdrop.hidden = true;
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('store-menu-open');
    syncMenuInert();
  }

  function cardTokens(card, dim) {
    return (card.getAttribute('data-gallery-' + dim) || '').split(/\s+/).filter(Boolean);
  }

  function cardMatches(card) {
    var dims = ['type', 'color', 'country'];
    for (var i = 0; i < dims.length; i += 1) {
      var wanted = active[dims[i]];
      if (!wanted.length) continue;
      var tokens = cardTokens(card, dims[i]);
      var hit = false;
      for (var j = 0; j < tokens.length; j += 1) {
        if (wanted.indexOf(tokens[j]) !== -1) { hit = true; break; }
      }
      if (!hit) return false;
    }
    return true;
  }

  function hasActive() {
    return active.type.length + active.color.length + active.country.length > 0;
  }

  function syncClear() {
    if (!clearBtn) return;
    var on = !hasActive();
    clearBtn.classList.toggle('is-active', on);
    clearBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  var BATCH = 6;
  var visibleCount = BATCH;

  function applyFilter() {
    var cards = grid.querySelectorAll('.gallery-card');
    var matched = 0;
    var shown = 0;
    cards.forEach(function (card) {
      if (cardMatches(card)) {
        matched += 1;
        if (shown < visibleCount) {
          card.hidden = false;
          shown += 1;
        } else {
          card.hidden = true;
        }
      } else {
        card.hidden = true;
      }
    });
    if (empty) empty.hidden = matched > 0;
    if (moreBtn) moreBtn.hidden = matched <= shown;
    return shown;
  }

  function applySort() {
    var mode = select ? (select.value || 'default') : 'default';
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.gallery-card'));
    cards.sort(function (a, b) {
      var pa = Number(a.getAttribute('data-price')) || 0;
      var pb = Number(b.getAttribute('data-price')) || 0;
      if (mode === 'price-asc' && pa !== pb) return pa - pb;
      if (mode === 'price-desc' && pa !== pb) return pb - pa;
      var oa = Number(a.getAttribute('data-order')) || 0;
      var ob = Number(b.getAttribute('data-order')) || 0;
      return oa - ob;
    });
    cards.forEach(function (card) {
      grid.appendChild(card);
    });
  }

  /* Card mini-galleries: browse several photos inside one item. */
  function activateCardImage(media, index) {
    if (!media) return;
    var imgs = media.querySelectorAll('.gallery-card__img');
    if (!imgs.length) return;
    var i = ((index % imgs.length) + imgs.length) % imgs.length;
    imgs.forEach(function (img, k) {
      var on = k === i;
      img.classList.toggle('is-active', on);
      if (on && !img.getAttribute('src') && img.getAttribute('data-src')) {
        img.setAttribute('src', img.getAttribute('data-src'));
        img.classList.add('loaded');
      }
    });
    media.querySelectorAll('.gallery-card__dot').forEach(function (dot, k) {
      dot.classList.toggle('is-active', k === i);
      dot.setAttribute('aria-pressed', k === i ? 'true' : 'false');
    });
  }

  function activeCardIndex(media) {
    var imgs = media.querySelectorAll('.gallery-card__img');
    for (var i = 0; i < imgs.length; i += 1) {
      if (imgs[i].classList.contains('is-active')) return i;
    }
    return 0;
  }

  function closestMatch(node, selector) {
    var guard = 0;
    while (node && guard < 40) {
      guard += 1;
      if (node.nodeType === 1) {
        var fn = node.matches || node.webkitMatchesSelector || node.msMatchesSelector;
        if (typeof fn === 'function' && fn.call(node, selector)) return node;
      }
      node = node.parentElement || node.parentNode;
    }
    return null;
  }

  document.addEventListener('click', function (event) {
    var dot = closestMatch(event.target, '[data-card-dot]');
    if (!dot) return;
    var media = closestMatch(dot, '.gallery-card__media');
    if (!media) return;
    event.preventDefault();
    activateCardImage(media, Number(dot.getAttribute('data-card-dot')) || 0);
  });

  grid.querySelectorAll('.gallery-card__photos').forEach(function (photos) {
    var startX = null;
    photos.addEventListener('touchstart', function (e) {
      startX = e.touches && e.touches.length ? e.touches[0].clientX : null;
    }, { passive: true });
    photos.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var endX = e.changedTouches && e.changedTouches.length ? e.changedTouches[0].clientX : startX;
      var dx = endX - startX;
      startX = null;
      if (Math.abs(dx) < 30) return;
      var media = closestMatch(photos, '.gallery-card__media');
      if (!media) return;
      activateCardImage(media, activeCardIndex(media) + (dx < 0 ? 1 : -1));
    });
  });

  grid.querySelectorAll('.gallery-card__media').forEach(function (media) {
    activateCardImage(media, 0);
  });

  filterButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var dim = btn.getAttribute('data-gallery-filter');
      var val = btn.getAttribute('data-gallery-value');
      if (!dim || !val || !active[dim]) return;
      var list = active[dim];
      var idx = list.indexOf(val);
      var on;
      if (idx === -1) { list.push(val); on = true; } else { list.splice(idx, 1); on = false; }
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      syncClear();
      visibleCount = BATCH;
      applyFilter();
    });
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      active.type = [];
      active.color = [];
      active.country = [];
      filterButtons.forEach(function (btn) {
        btn.classList.remove('is-active');
        btn.setAttribute('aria-pressed', 'false');
      });
      syncClear();
      visibleCount = BATCH;
      applyFilter();
    });
  }

  if (moreBtn) {
    moreBtn.addEventListener('click', function () {
      visibleCount += BATCH;
      applyFilter();
    });
  }

  if (select) {
    select.addEventListener('change', function () {
      visibleCount = BATCH;
      applySort();
      applyFilter();
    });
  }

  if (menuToggle) {
    menuToggle.addEventListener('click', function () {
      if (menuOpen) closeMenu();
      else openMenu();
    });
  }
  if (menuClose) menuClose.addEventListener('click', closeMenu);
  if (menuBackdrop) menuBackdrop.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeMenu();
  });

  function onDrawerMqChange(event) {
    if (!event.matches) closeMenu();
    syncMenuInert();
  }
  if (drawerMq.addEventListener) drawerMq.addEventListener('change', onDrawerMqChange);
  else if (drawerMq.addListener) drawerMq.addListener(onDrawerMqChange);
  syncMenuInert();

  syncClear();
  applyFilter();
})();