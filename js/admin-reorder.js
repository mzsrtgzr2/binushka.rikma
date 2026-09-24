/**
 * Makes a backoffice list reorderable, and reports the order back.
 *
 * Both list pages want the same thing, so it lives here rather than being
 * written twice. Dragging is the fast way and the arrows are the one that
 * works everywhere — on a phone, from the keyboard, and for anyone who would
 * rather not drag — so both are wired to the same move.
 */
(function () {
  function AdminReorder() {}

  /**
   * `list` is the <ul>; every direct child matching `itemSelector` is a row.
   * `onChange` is handed the row keys, top first, after every move.
   */
  AdminReorder.attach = function (list, options) {
    if (!list) return null;

    var itemSelector = options.itemSelector || '.admin-card';
    var keyAttribute = options.keyAttribute || 'data-slug';
    var onChange = options.onChange || function () {};

    function items() {
      return Array.prototype.slice.call(list.querySelectorAll(itemSelector));
    }

    function keys() {
      return items().map(function (item) {
        return item.getAttribute(keyAttribute) || '';
      });
    }

    /* The arrows at the ends of the list do nothing, and a button that looks
       ready but is not is worse than one that says so. */
    function syncEnds() {
      var rows = items();
      rows.forEach(function (row, index) {
        var up = row.querySelector('[data-move="up"]');
        var down = row.querySelector('[data-move="down"]');
        if (up) up.disabled = index === 0;
        if (down) down.disabled = index === rows.length - 1;
      });
    }

    function changed() {
      syncEnds();
      onChange(keys());
    }

    function move(row, direction) {
      if (direction === 'up') {
        var before = row.previousElementSibling;
        if (!before) return false;
        list.insertBefore(row, before);
      } else {
        var after = row.nextElementSibling;
        if (!after) return false;
        list.insertBefore(after, row);
      }
      return true;
    }

    list.addEventListener('click', function (event) {
      var button = event.target.closest('[data-move]');
      if (!button || button.disabled) return;

      var row = button.closest(itemSelector);
      if (!row || !move(row, button.getAttribute('data-move'))) return;

      changed();

      // The row moved out from under the pointer, so the button that was just
      // pressed has to be found again for a second press to land on it.
      var again = row.querySelector('[data-move="' + button.getAttribute('data-move') + '"]');
      if (again && !again.disabled) again.focus();
      else row.scrollIntoView({ block: 'nearest' });
    });

    /* ------------------------------------------------------------- dragging */

    var dragging = null;

    list.addEventListener('dragstart', function (event) {
      var handle = event.target.closest('[data-drag-handle]');
      if (!handle) return;

      dragging = handle.closest(itemSelector);
      if (!dragging) return;

      dragging.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      // Firefox refuses to start a drag without something on the transfer.
      event.dataTransfer.setData('text/plain', dragging.getAttribute(keyAttribute) || '');
      if (event.dataTransfer.setDragImage) {
        event.dataTransfer.setDragImage(dragging, 20, 20);
      }
    });

    list.addEventListener('dragover', function (event) {
      if (!dragging) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';

      var over = event.target.closest(itemSelector);
      if (!over || over === dragging) return;

      // Past the middle of the row under the pointer means the dragged row
      // belongs after it, which is what makes the gap follow the cursor
      // instead of jumping only once the rows are fully swapped.
      var box = over.getBoundingClientRect();
      var below = event.clientY > box.top + box.height / 2;
      list.insertBefore(dragging, below ? over.nextElementSibling : over);
    });

    list.addEventListener('drop', function (event) {
      if (!dragging) return;
      event.preventDefault();
    });

    list.addEventListener('dragend', function () {
      if (!dragging) return;
      dragging.classList.remove('is-dragging');
      dragging = null;
      changed();
    });

    return { keys: keys, refresh: syncEnds };
  };

  window.AdminReorder = AdminReorder;
})();
