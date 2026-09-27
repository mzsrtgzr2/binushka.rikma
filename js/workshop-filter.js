(function () {
  var grid = document.getElementById('workshops-grid');
  var filters = document.getElementById('workshop-filters');
  var empty = document.getElementById('workshop-filter-empty');
  if (!grid || !filters) return;

  var categoryButtons = filters.querySelectorAll('[data-workshop-category]');
  var monthButtons = filters.querySelectorAll('[data-workshop-month]');
  var activeCategory = '';
  var activeMonth = '';

  function track(name, params) {
    if (window.Analytics) Analytics.track(name, params);
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
    monthButtons.forEach(function (btn) {
      var match = (btn.getAttribute('data-workshop-month') || '') === activeMonth;
      btn.classList.toggle('is-active', match);
      btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    });
  }

  function matchesMonth(el) {
    if (!activeMonth) return true;
    var months = (el.getAttribute('data-month') || '').trim().split(/\s+/).filter(Boolean);
    return months.indexOf(activeMonth) !== -1;
  }

  function applyFilter() {
    var items = grid.querySelectorAll('.project');
    var visible = 0;
    items.forEach(function (el) {
      var categoryMatch = !activeCategory || el.getAttribute('data-category') === activeCategory;
      var match = categoryMatch && matchesMonth(el);
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
    if (categoryBtn && filters.contains(categoryBtn)) {
      setActiveCategory(categoryBtn.getAttribute('data-workshop-category') || '');
      var categoryResults = applyFilter();
      track('workshop_filter', {
        filter_type: 'category',
        category: activeCategory || 'all',
        month: activeMonth || 'all',
        results: categoryResults,
      });
      return;
    }

    var monthBtn = event.target.closest('[data-workshop-month]');
    if (monthBtn && filters.contains(monthBtn)) {
      setActiveMonth(monthBtn.getAttribute('data-workshop-month') || '');
      var monthResults = applyFilter();
      track('workshop_filter', {
        filter_type: 'month',
        category: activeCategory || 'all',
        month: activeMonth || 'all',
        results: monthResults,
      });
    }
  });

  setActiveCategory('');
  setActiveMonth('');
  applyFilter();
})();
