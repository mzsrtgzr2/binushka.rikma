(function () {
  var grid = document.getElementById('workshops-grid');
  var filters = document.getElementById('workshop-filters');
  var empty = document.getElementById('workshop-filter-empty');
  if (!grid || !filters) return;

  var buttons = filters.querySelectorAll('[data-workshop-category]');
  var dateFrom = document.getElementById('workshop-date-from');
  var dateTo = document.getElementById('workshop-date-to');
  var dateClear = document.getElementById('workshop-date-clear');
  var active = '';

  function setActive(category) {
    active = category || '';
    buttons.forEach(function (btn) {
      var match = (btn.getAttribute('data-workshop-category') || '') === active;
      btn.classList.toggle('is-active', match);
      btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    });
  }

  function dateValue(input) {
    return input && input.value ? input.value : '';
  }

  function syncClearButton() {
    if (!dateClear) return;
    dateClear.hidden = !(dateValue(dateFrom) || dateValue(dateTo));
  }

  function matchesDateRange(el) {
    var from = dateValue(dateFrom);
    var to = dateValue(dateTo);
    if (!from && !to) return true;

    var workshopDate = el.getAttribute('data-date') || '';
    if (!workshopDate) return false;

    if (from && to && from > to) {
      var swap = from;
      from = to;
      to = swap;
    }

    if (from && workshopDate < from) return false;
    if (to && workshopDate > to) return false;
    return true;
  }

  function applyFilter() {
    var items = grid.querySelectorAll('.project');
    var visible = 0;
    items.forEach(function (el) {
      var categoryMatch = !active || el.getAttribute('data-category') === active;
      var match = categoryMatch && matchesDateRange(el);
      if (match) {
        el.removeAttribute('hidden');
        visible += 1;
      } else {
        el.setAttribute('hidden', '');
      }
    });
    if (empty) empty.hidden = visible > 0;
    syncClearButton();
  }

  filters.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-workshop-category]');
    if (!btn || !filters.contains(btn)) return;
    setActive(btn.getAttribute('data-workshop-category') || '');
    applyFilter();
  });

  function onDateChange() {
    applyFilter();
  }

  if (dateFrom) dateFrom.addEventListener('change', onDateChange);
  if (dateTo) dateTo.addEventListener('change', onDateChange);
  if (dateClear) {
    dateClear.addEventListener('click', function () {
      if (dateFrom) dateFrom.value = '';
      if (dateTo) dateTo.value = '';
      applyFilter();
    });
  }

  setActive('');
  applyFilter();
})();
