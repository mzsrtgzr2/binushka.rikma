(function () {
  var grid = document.getElementById('workshops-grid');
  var filters = document.getElementById('workshop-filters');
  var monthSelect = document.getElementById('workshop-month');
  var empty = document.getElementById('workshop-filter-empty');
  var menu = document.getElementById('workshop-menu');
  var menuToggle = document.getElementById('workshop-menu-toggle');
  var menuClose = document.getElementById('workshop-menu-close');
  var menuBackdrop = document.getElementById('workshop-menu-backdrop');
  if (!grid || !filters) return;

  var categoryButtons = filters.querySelectorAll('[data-workshop-category]');
  var activeCategory = '';
  var activeMonth = '';
  var menuOpen = false;
  var drawerMq = window.matchMedia('(max-width: 768px)');

  function track(name, params) {
    if (window.Analytics) Analytics.track(name, params);
  }

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

  function setActiveCategory(category) {
    activeCategory = category || '';
    categoryButtons.forEach(function (btn) {
      var match = (btn.getAttribute('data-workshop-category') || '') === activeCategory;
      btn.classList.toggle('is-active', match);
      btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    });
  }

  function setActiveMonth(month) {
    activeMonth = month || '';
    if (monthSelect && monthSelect.value !== activeMonth) {
      monthSelect.value = activeMonth;
    }
  }

  function matchesMonth(el) {
    if (!activeMonth) return true;
    var months = (el.getAttribute('data-month') || '').trim().split(/\s+/).filter(Boolean);
    return months.indexOf(activeMonth) !== -1;
  }

  // Beginners / advanced filters also include "all levels" workshops.
  function matchesCategory(el) {
    if (!activeCategory) return true;
    var category = el.getAttribute('data-category') || '';
    if (category === activeCategory) return true;
    if (
      (activeCategory === 'beginners' || activeCategory === 'advanced') &&
      category === 'all-levels'
    ) {
      return true;
    }
    return false;
  }

  function applyFilter() {
    var items = grid.querySelectorAll('.project');
    var visible = 0;
    items.forEach(function (el) {
      var match = matchesCategory(el) && matchesMonth(el);
      if (match) {
        el.removeAttribute('hidden');
        visible += 1;
      } else {
        el.setAttribute('hidden', '');
      }
    });
    if (empty) empty.hidden = visible > 0;
    return visible;
  }

  filters.addEventListener('click', function (event) {
    var categoryBtn = event.target.closest('[data-workshop-category]');
    if (!categoryBtn || !filters.contains(categoryBtn)) return;
    setActiveCategory(categoryBtn.getAttribute('data-workshop-category') || '');
    var categoryResults = applyFilter();
    track('workshop_filter', {
      filter_type: 'category',
      category: activeCategory || 'all',
      month: activeMonth || 'all',
      results: categoryResults,
    });
    closeMenu();
  });

  if (monthSelect) {
    monthSelect.addEventListener('change', function () {
      setActiveMonth(monthSelect.value || '');
      var monthResults = applyFilter();
      track('workshop_filter', {
        filter_type: 'month',
        category: activeCategory || 'all',
        month: activeMonth || 'all',
        results: monthResults,
      });
    });
  }

  if (menuToggle) {
    menuToggle.addEventListener('click', function () {
      if (menuOpen) closeMenu();
      else openMenu();
    });
  }

  if (menuClose) {
    menuClose.addEventListener('click', closeMenu);
  }

  if (menuBackdrop) {
    menuBackdrop.addEventListener('click', closeMenu);
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeMenu();
  });

  function onDrawerMqChange(event) {
    if (!event.matches) closeMenu();
    syncMenuInert();
  }
  if (drawerMq.addEventListener) {
    drawerMq.addEventListener('change', onDrawerMqChange);
  } else if (drawerMq.addListener) {
    drawerMq.addListener(onDrawerMqChange);
  }
  syncMenuInert();

  setActiveCategory('');
  setActiveMonth(monthSelect ? monthSelect.value || '' : '');
  applyFilter();
})();
