(function () {
  var grid = document.getElementById('scrunchies-gallery-grid');
  var select = document.getElementById('gallery-sort');
  var menu = document.getElementById('store-menu');
  if (!grid || !select) return;

  var menuToggle = document.getElementById('store-menu-toggle');
  var menuClose = document.getElementById('store-menu-close');
  var menuBackdrop = document.getElementById('store-menu-backdrop');
  var empty = document.getElementById('gallery-filter-empty');

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

  function applyFilter() {
    var cards = grid.querySelectorAll('.gallery-card');
    var visible = 0;
    cards.forEach(function (card) {
      if (cardMatches(card)) {
        card.hidden = false;
        visible += 1;
      } else {
        card.hidden = true;
      }
    });
    if (empty) empty.hidden = visible > 0;
    return visible;
  }

  function applySort() {
    var mode = select.value || 'default';
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
      applyFilter();
    });
  }

  select.addEventListener('change', applySort);

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