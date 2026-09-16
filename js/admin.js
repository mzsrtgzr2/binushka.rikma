/**
 * Store backoffice: login, list products, save stock flags.
 */
(function () {
  var loginForm = document.getElementById('admin-login');
  var loginMessage = document.getElementById('admin-login-message');
  var board = document.getElementById('admin-board');
  var boardMessage = document.getElementById('admin-board-message');
  var listEl = document.getElementById('admin-list');
  var saveBtn = document.getElementById('admin-save');
  var logoutBtn = document.getElementById('admin-logout');
  if (!loginForm || !board) return;

  var products = [];
  var original = {};

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function show(el, text, type) {
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.className = 'admin-message admin-message--' + (type || 'info');
  }

  function api(method, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch('/api/admin/', opts).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        if (text) {
          try {
            data = JSON.parse(text);
          } catch (e) {
            data = {};
          }
        }
        if (!res.ok) {
          throw new Error(data.error || 'שגיאה');
        }
        return data;
      });
    });
  }

  function snapshot(list) {
    var map = {};
    (list || []).forEach(function (p) {
      map[p.slug] = {
        out_of_stock: Boolean(p.out_of_stock),
        limited_stock: Boolean(p.limited_stock),
        hide: Boolean(p.hide),
      };
    });
    return map;
  }

  function isDirty() {
    return products.some(function (p) {
      var orig = original[p.slug] || {};
      return (
        Boolean(p.out_of_stock) !== Boolean(orig.out_of_stock) ||
        Boolean(p.limited_stock) !== Boolean(orig.limited_stock) ||
        Boolean(p.hide) !== Boolean(orig.hide)
      );
    });
  }

  function statusLabel(p) {
    if (p.hide) return 'מוסתר';
    if (p.out_of_stock) return 'אזל';
    if (p.limited_stock) return 'מלאי מוגבל';
    return 'במלאי';
  }

  function render() {
    listEl.innerHTML = products
      .map(function (p) {
        var img = p.image
          ? '<img class="admin-card__thumb" src="' + p.image + '" alt="">'
          : '<span class="admin-card__thumb admin-card__thumb--empty"></span>';
        return (
          '<li class="admin-card" data-slug="' +
          p.slug +
          '">' +
          img +
          '<div class="admin-card__body">' +
          '<div class="admin-card__head">' +
          '<strong>' +
          escapeHtml(p.title) +
          '</strong>' +
          '<span class="admin-card__badge">' +
          statusLabel(p) +
          '</span>' +
          '</div>' +
          (p.price ? '<p class="admin-card__price">' + escapeHtml(p.price) + '</p>' : '') +
          '<label class="admin-check"><input type="checkbox" data-flag="out_of_stock"' +
          (p.out_of_stock ? ' checked' : '') +
          '> אזל מהמלאי</label>' +
          '<label class="admin-check"><input type="checkbox" data-flag="limited_stock"' +
          (p.limited_stock ? ' checked' : '') +
          '> מלאי מוגבל</label>' +
          '<label class="admin-check"><input type="checkbox" data-flag="hide"' +
          (p.hide ? ' checked' : '') +
          '> הסתר מהחנות</label>' +
          '</div></li>'
        );
      })
      .join('');
    saveBtn.disabled = !isDirty();
  }

  function showBoard() {
    loginForm.hidden = true;
    board.hidden = false;
    logoutBtn.hidden = false;
  }

  function showLogin() {
    loginForm.hidden = false;
    board.hidden = true;
    logoutBtn.hidden = true;
    products = [];
  }

  function loadBoard() {
    return api('GET').then(function (data) {
      products = data.products || [];
      original = snapshot(products);
      showBoard();
      render();
      show(boardMessage, '', '');
    });
  }

  loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var password = document.getElementById('admin-password').value;
    show(loginMessage, '', '');
    api('POST', { action: 'login', password: password })
      .then(loadBoard)
      .catch(function (err) {
        show(loginMessage, err.message || 'סיסמה שגויה', 'error');
      });
  });

  listEl.addEventListener('change', function (event) {
    var input = event.target.closest('input[data-flag]');
    if (!input) return;
    var card = input.closest('[data-slug]');
    var product = products.find(function (p) {
      return p.slug === card.getAttribute('data-slug');
    });
    if (!product) return;
    product[input.getAttribute('data-flag')] = input.checked;
    render();
  });

  saveBtn.addEventListener('click', function () {
    saveBtn.disabled = true;
    show(boardMessage, 'שומרת…', 'info');
    api('POST', { action: 'save', products: products })
      .then(function (data) {
        original = snapshot(products);
        render();
        var n = (data.changed || []).length;
        var msg =
          n === 0
            ? 'אין שינויים לשמור'
            : data.target === 'local'
              ? 'נשמר. רענון החנות יופיע אחרי שהאתר נבנה מחדש.'
              : 'נשמר. האתר יתעדכן אחרי הבילד ב-Vercel (בדרך כלל עד דקה-שתיים).';
        show(boardMessage, msg, 'ok');
      })
      .catch(function (err) {
        show(boardMessage, err.message || 'לא הצלחנו לשמור', 'error');
        saveBtn.disabled = !isDirty();
      });
  });

  logoutBtn.addEventListener('click', function () {
    api('POST', { action: 'logout' }).finally(function () {
      showLogin();
      loginForm.reset();
    });
  });

  loadBoard().catch(function () {
    showLogin();
  });
})();
