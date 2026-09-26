/**
 * Coupon backoffice: list, create, edit, delete codes.
 * Login and coupon CRUD both go through /api/admin/ (shared session + Hobby
 * function budget — a dedicated /api/admin-coupons would exceed the 12-function cap).
 */
(function () {
  var loginForm = document.getElementById('admin-login');
  var loginMessage = document.getElementById('admin-login-message');
  var board = document.getElementById('admin-board');
  var boardMessage = document.getElementById('admin-board-message');
  var form = document.getElementById('admin-coupon-form');
  var formMessage = document.getElementById('admin-form-message');
  var formLegend = document.getElementById('admin-form-legend');
  var listEl = document.getElementById('admin-list');
  var statsEl = document.getElementById('admin-stats');
  var logoutBtn = document.getElementById('admin-logout');
  var codeInput = document.getElementById('coupon-code');
  var typeInput = document.getElementById('coupon-type');
  var valueInput = document.getElementById('coupon-value');
  var valueHint = document.getElementById('coupon-value-hint');
  var noteInput = document.getElementById('coupon-note');
  var activeInput = document.getElementById('coupon-active');
  var cancelBtn = document.getElementById('coupon-cancel');
  if (!loginForm || !board || !form) return;

  var coupons = [];
  var editing = null;

  function escapeHtml(value) {
    var holder = document.createElement('div');
    holder.textContent = value == null ? '' : String(value);
    return holder.innerHTML;
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

  function errorText(code) {
    var messages = {
      unauthorized: 'צריך להתחבר',
      no_write_target: 'חסרה הגדרת GITHUB_TOKEN — אי אפשר לשמור קופונים',
      not_found: 'הקוד לא נמצא',
      code_taken: 'כבר יש קוד כזה',
      code_invalid: 'קוד לא תקין (אותיות באנגלית, ספרות, מקף או קו תחתון)',
      code_immutable: 'אי אפשר לשנות את הקוד אחרי יצירה — מחקי וצרי חדש',
      type_invalid: 'סוג הנחה לא תקין',
      value_invalid: 'ערך לא תקין',
      invalid_request: 'הבקשה לא תקינה'
    };
    return messages[code] || '';
  }

  function request(url, method, body) {
    var opts = { method: method, credentials: 'same-origin', cache: 'no-store', headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
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
          var error = new Error(data.error || errorText(data.code) || 'שגיאה');
          error.status = res.status;
          error.code = data.code;
          throw error;
        }
        return data;
      });
    });
  }

  function api(method, body) {
    if (method === 'GET') {
      return request('/api/admin/?resource=coupons', 'GET');
    }
    var payload = Object.assign({}, body || {});
    if (payload.action === 'save') payload.action = 'coupon-save';
    if (payload.action === 'delete') payload.action = 'coupon-delete';
    return request('/api/admin/', method, payload);
  }

  function formatDiscount(row) {
    if (row.type === 'percent') return row.value + '%';
    return '₪' + row.value;
  }

  function syncValueHint() {
    if (!valueHint) return;
    valueHint.textContent =
      typeInput.value === 'percent'
        ? 'מספר בין 1 ל־100 (אחוז הנחה מסכום המוצרים).'
        : 'סכום בשקלים שלמים שיופחת מסכום המוצרים.';
    valueInput.max = typeInput.value === 'percent' ? '100' : '100000';
    valueInput.step = typeInput.value === 'percent' ? '0.01' : '1';
  }

  function resetForm() {
    editing = null;
    form.reset();
    activeInput.checked = true;
    codeInput.readOnly = false;
    if (formLegend) formLegend.textContent = 'קוד חדש';
    if (cancelBtn) cancelBtn.hidden = true;
    show(formMessage, '');
    syncValueHint();
  }

  function fillForm(row) {
    editing = row;
    codeInput.value = row.code;
    codeInput.readOnly = true;
    typeInput.value = row.type;
    valueInput.value = row.value;
    noteInput.value = row.note || '';
    activeInput.checked = row.active !== false;
    if (formLegend) formLegend.textContent = 'עריכת ' + row.code;
    if (cancelBtn) cancelBtn.hidden = false;
    show(formMessage, '');
    syncValueHint();
    codeInput.focus();
  }

  function renderList() {
    if (!listEl) return;
    if (!coupons.length) {
      listEl.innerHTML = '<li class="admin-hint">עדיין אין קודי קופון.</li>';
      if (statsEl) statsEl.textContent = '';
      return;
    }
    if (statsEl) {
      var active = coupons.filter(function (row) {
        return row.active !== false;
      }).length;
      statsEl.textContent = coupons.length + ' קודים · ' + active + ' פעילים';
    }
    listEl.innerHTML = coupons
      .map(function (row) {
        var status = row.active !== false ? 'פעיל' : 'כבוי';
        return (
          '<li class="admin-card admin-card--plain" data-code="' +
          escapeHtml(row.code) +
          '">' +
          '<div class="admin-card__body">' +
          '<div class="admin-card__head">' +
          '<strong class="admin-input--ltr" dir="ltr">' +
          escapeHtml(row.code) +
          '</strong>' +
          '<span class="admin-card__badge' +
          (row.active !== false ? ' admin-card__badge--sent' : ' admin-card__badge--draft') +
          '">' +
          status +
          '</span>' +
          '</div>' +
          '<p class="admin-card__meta">' +
          escapeHtml(formatDiscount(row)) +
          (row.note ? ' · ' + escapeHtml(row.note) : '') +
          '</p>' +
          '<div class="admin-card__actions">' +
          '<button type="button" class="admin-card__edit" data-action="edit">עריכה</button>' +
          '<button type="button" class="admin-card__edit" data-action="delete">מחיקה</button>' +
          '</div>' +
          '</div></li>'
        );
      })
      .join('');
  }

  function loadBoard() {
    return api('GET').then(function (data) {
      coupons = data.coupons || [];
      board.hidden = false;
      loginForm.hidden = true;
      if (logoutBtn) logoutBtn.hidden = false;
      renderList();
      resetForm();
      show(boardMessage, '');
    });
  }

  function consumeLoginQuery() {
    var match = /[?&]login=(error|locked)\b/.exec(window.location.search);
    if (!match) return;
    show(
      loginMessage,
      match[1] === 'locked' ? 'יותר מדי ניסיונות. נסי שוב בעוד כמה דקות' : 'סיסמה שגויה',
      'error'
    );
    if (history.replaceState) history.replaceState({}, '', window.location.pathname);
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      var logoutForm = document.createElement('form');
      logoutForm.method = 'post';
      logoutForm.action = loginForm.getAttribute('action') || '/api/admin/';
      [
        ['action', 'logout'],
        ['next', window.location.pathname]
      ].forEach(function (pair) {
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = pair[0];
        input.value = pair[1];
        logoutForm.appendChild(input);
      });
      document.body.appendChild(logoutForm);
      logoutForm.submit();
    });
  }

  typeInput.addEventListener('change', syncValueHint);

  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      resetForm();
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var payload = {
      action: 'save',
      code: editing ? editing.code : undefined,
      coupon: {
        code: codeInput.value,
        type: typeInput.value,
        value: Number(valueInput.value),
        note: noteInput.value,
        active: activeInput.checked
      }
    };
    show(formMessage, 'שומרת…', 'info');
    api('POST', payload)
      .then(function () {
        show(formMessage, 'נשמר', 'ok');
        return loadBoard();
      })
      .catch(function (err) {
        show(formMessage, err.message || 'שמירה נכשלה', 'error');
      });
  });

  listEl.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-action]');
    if (!btn) return;
    var item = btn.closest('[data-code]');
    if (!item) return;
    var code = item.getAttribute('data-code');
    var row = coupons.find(function (c) {
      return c.code === code;
    });
    if (!row) return;

    if (btn.getAttribute('data-action') === 'edit') {
      fillForm(row);
      return;
    }

    if (btn.getAttribute('data-action') === 'delete') {
      if (!window.confirm('למחוק את הקוד ' + code + '?')) return;
      show(boardMessage, 'מוחקת…', 'info');
      api('POST', { action: 'delete', code: code })
        .then(function () {
          return loadBoard();
        })
        .then(function () {
          show(boardMessage, 'נמחק', 'ok');
        })
        .catch(function (err) {
          show(boardMessage, err.message || 'מחיקה נכשלה', 'error');
        });
    }
  });

  syncValueHint();
  // Real form POST for login keeps the HttpOnly session cookie; an existing
  // session skips the password prompt.
  loadBoard().catch(function (err) {
    loginForm.hidden = false;
    board.hidden = true;
    if (logoutBtn) logoutBtn.hidden = true;
    consumeLoginQuery();
    if (err && err.status === 401) return;
    show(loginMessage, (err && err.message) || 'לא הצלחנו לטעון. נסי לרענן.', 'error');
  });
})();
