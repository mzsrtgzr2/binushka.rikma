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

  // A click inside the filter bar can target a text node or the document.
  // Those nodes have no closest(), and calling it threw an unhandled TypeError.
  function eventClosest(event, selector) {
    var node = event && event.target;
    if (!node) return null;
    if (node.nodeType === 3) node = node.parentElement;
    if (!node || typeof node.closest !== 'function') return null;
    return node.closest(selector);
  }

  filters.addEventListener('click', function (event) {
    var categoryBtn = eventClosest(event, '[data-workshop-category]');
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

    var monthBtn = eventClosest(event, '[data-workshop-month]');
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
