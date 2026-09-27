(function () {
  var grid = document.getElementById('workshops-grid');
  var filters = document.getElementById('workshop-filters');
  var empty = document.getElementById('workshop-filter-empty');
  if (!grid || !filters) return;

  var buttons = filters.querySelectorAll('[data-workshop-category]');
  var active = '';

  function setActive(category) {
    active = category || '';
    buttons.forEach(function (btn) {
      var match = (btn.getAttribute('data-workshop-category') || '') === active;
      btn.classList.toggle('is-active', match);
      btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    });
  }

  function applyFilter() {
    var items = grid.querySelectorAll('.project');
    var visible = 0;
    items.forEach(function (el) {
      var match = !active || el.getAttribute('data-category') === active;
      if (match) {
        el.removeAttribute('hidden');
        visible += 1;
      } else {
        el.setAttribute('hidden', '');
      }
    });
    if (empty) empty.hidden = visible > 0;
  }

  filters.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-workshop-category]');
    if (!btn || !filters.contains(btn)) return;
    setActive(btn.getAttribute('data-workshop-category') || '');
    applyFilter();
  });

  setActive('');
  applyFilter();
})();
