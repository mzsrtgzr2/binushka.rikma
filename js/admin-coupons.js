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
  var expiresInput = document.getElementById('coupon-expires');
  var minPurchaseInput = document.getElementById('coupon-min-purchase');
  var appliesToInput = document.getElementById('coupon-applies-to');
  var categoryGroup = document.getElementById('coupon-category-group');
  var categoryInput = document.getElementById('coupon-category');
  var productGroup = document.getElementById('coupon-product-group');
  var productInput = document.getElementById('coupon-product');
  var activeInput = document.getElementById('coupon-active');
  var cancelBtn = document.getElementById('coupon-cancel');
  if (!loginForm || !board || !form) return;

  var coupons = [];
  var products = [];
  var editing = null;

  var CATEGORY_LABELS = {
    'embroidery-supplies': 'ציוד רקמה',
    'works-for-sale': 'עבודות למכירה',
    workshops: 'סדנאות'
  };

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
      value_required: 'צריך למלא את שדה הערך (סכום או אחוז ההנחה)',
      value_invalid:
        'ערך לא תקין — לסכום קבוע יש להזין מספר שלם בשקלים, ולאחוזים מספר בין 1 ל־99 (לא 100%)',
      expires_invalid: 'תאריך תפוגה לא תקין',
      min_purchase_invalid: 'מינימום רכישה לא תקין (מספר שלם בשקלים)',
      applies_to_invalid: 'בחרי על מה הקופון חל',
      category_invalid: 'בחרי קטגוריה',
      product_invalid: 'בחרי מוצר',
      invalid_request: 'הבקשה לא תקינה'
    };
    return messages[code] || '';
  }

  function fieldEl(name) {
    if (name === 'code') return codeInput;
    if (name === 'type') return typeInput;
    if (name === 'value') return valueInput;
    if (name === 'expires') return expiresInput;
    if (name === 'min_purchase') return minPurchaseInput;
    if (name === 'applies_to') return appliesToInput;
    if (name === 'category') return categoryInput;
    if (name === 'product') return productInput;
    return null;
  }

  function readDiscountValue() {
    if (!valueInput) return NaN;
    var raw = String(valueInput.value || '')
      .trim()
      .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
      .replace(',', '.');
    if (!raw) return NaN;
    var n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }

  function readMinPurchase() {
    if (!minPurchaseInput) return 0;
    var raw = String(minPurchaseInput.value || '').trim();
    if (!raw) return 0;
    var n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return Math.round(n);
  }

  function syncScopeFields() {
    var scope = appliesToInput ? appliesToInput.value : 'all';
    if (categoryGroup) categoryGroup.hidden = scope !== 'category';
    if (productGroup) productGroup.hidden = scope !== 'product';
  }

  function fillProductOptions(selected) {
    if (!productInput) return;
    var current = selected || productInput.value || '';
    var options =
      '<option value="">בחרי מוצר</option>' +
      products
        .slice()
        .sort(function (a, b) {
          return String(a.title || a.slug).localeCompare(String(b.title || b.slug), 'he');
        })
        .map(function (p) {
          return (
            '<option value="' +
            escapeHtml(p.slug) +
            '"' +
            (p.slug === current ? ' selected' : '') +
            '>' +
            escapeHtml(p.title || p.slug) +
            '</option>'
          );
        })
        .join('');
    productInput.innerHTML = options;
  }

  function validateBeforeSave() {
    var code = String(codeInput.value || '').trim();
    if (!code) {
      show(formMessage, errorText('code_invalid') || 'יש להזין קוד', 'error');
      codeInput.focus();
      return null;
    }
    var type = typeInput.value;
    if (type !== 'percent' && type !== 'amount') {
      show(formMessage, errorText('type_invalid'), 'error');
      typeInput.focus();
      return null;
    }
    var value = readDiscountValue();
    if (!Number.isFinite(value)) {
      show(formMessage, errorText('value_required'), 'error');
      valueInput.focus();
      return null;
    }
    if (value <= 0 || (type === 'percent' && value >= 100)) {
      show(formMessage, errorText('value_invalid'), 'error');
      valueInput.focus();
      return null;
    }
    if (type === 'amount' && Math.abs(value - Math.round(value)) > 0.001) {
      show(formMessage, errorText('value_invalid'), 'error');
      valueInput.focus();
      return null;
    }
    var minPurchase = readMinPurchase();
    if (!Number.isFinite(minPurchase)) {
      show(formMessage, errorText('min_purchase_invalid'), 'error');
      if (minPurchaseInput) minPurchaseInput.focus();
      return null;
    }
    var appliesTo = appliesToInput ? appliesToInput.value : 'all';
    if (appliesTo !== 'all' && appliesTo !== 'category' && appliesTo !== 'product') {
      show(formMessage, errorText('applies_to_invalid'), 'error');
      if (appliesToInput) appliesToInput.focus();
      return null;
    }
    var category = categoryInput ? categoryInput.value : '';
    var product = productInput ? productInput.value : '';
    if (appliesTo === 'category' && !category) {
      show(formMessage, errorText('category_invalid'), 'error');
      if (categoryInput) categoryInput.focus();
      return null;
    }
    if (appliesTo === 'product' && !product) {
      show(formMessage, errorText('product_invalid'), 'error');
      if (productInput) productInput.focus();
      return null;
    }
    return {
      action: 'save',
      code: editing ? editing.code : undefined,
      coupon: {
        code: code,
        type: type,
        value: type === 'percent' ? value : Math.round(value),
        note: noteInput.value,
        expires: expiresInput ? expiresInput.value : '',
        min_purchase: minPurchase,
        applies_to: appliesTo,
        category: appliesTo === 'category' ? category : '',
        product: appliesTo === 'product' ? product : '',
        active: activeInput.checked
      }
    };
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
          error.field = data.field || null;
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

  function loadProducts() {
    return request('/api/admin/', 'GET').then(function (data) {
      products = (data.products || []).filter(function (p) {
        return p && p.slug && p.in_cart !== false && p.kind !== 'content';
      });
      fillProductOptions();
    });
  }

  function formatDiscount(row) {
    if (row.type === 'percent') return row.value + '%';
    return '₪' + row.value;
  }

  function formatScope(row) {
    if (row.applies_to === 'category' && row.category) {
      return 'קטגוריה: ' + (CATEGORY_LABELS[row.category] || row.category);
    }
    if (row.applies_to === 'product' && row.product) {
      var match = products.find(function (p) {
        return p.slug === row.product;
      });
      return 'מוצר: ' + (match ? match.title || match.slug : row.product);
    }
    return '';
  }

  function isExpiredRow(row) {
    if (!row || !row.expires) return false;
    var iso = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
    return iso > String(row.expires);
  }

  function statusLabel(row) {
    if (row.active === false) return 'כבוי';
    if (isExpiredRow(row)) return 'פג תוקף';
    return 'פעיל';
  }

  function syncValueHint() {
    if (!valueHint) return;
    valueHint.textContent =
      typeInput.value === 'percent'
        ? 'מספר בין 1 ל־99 (אחוז הנחה מסכום המוצרים). אי אפשר 100%.'
        : 'סכום בשקלים שלמים שיופחת מסכום המוצרים.';
    valueInput.max = typeInput.value === 'percent' ? '99' : '100000';
    // step=any avoids browsers clearing .value on step mismatch when switching
    // between percent (decimals) and amount (whole shekels).
    valueInput.step = 'any';
  }

  function resetForm() {
    editing = null;
    form.reset();
    activeInput.checked = true;
    if (expiresInput) expiresInput.value = '';
    if (minPurchaseInput) minPurchaseInput.value = '';
    if (appliesToInput) appliesToInput.value = 'all';
    if (categoryInput) categoryInput.value = '';
    fillProductOptions('');
    codeInput.readOnly = false;
    if (formLegend) formLegend.textContent = 'קוד חדש';
    if (cancelBtn) cancelBtn.hidden = true;
    show(formMessage, '');
    syncValueHint();
    syncScopeFields();
  }

  function fillForm(row) {
    editing = row;
    codeInput.value = row.code;
    codeInput.readOnly = true;
    typeInput.value = row.type;
    valueInput.value = row.value;
    noteInput.value = row.note || '';
    if (expiresInput) expiresInput.value = row.expires || '';
    if (minPurchaseInput) {
      minPurchaseInput.value = row.min_purchase > 0 ? row.min_purchase : '';
    }
    if (appliesToInput) appliesToInput.value = row.applies_to || 'all';
    if (categoryInput) categoryInput.value = row.category || '';
    fillProductOptions(row.product || '');
    activeInput.checked = row.active !== false;
    if (formLegend) formLegend.textContent = 'עריכת ' + row.code;
    if (cancelBtn) cancelBtn.hidden = false;
    show(formMessage, '');
    syncValueHint();
    syncScopeFields();
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
        return row.active !== false && !isExpiredRow(row);
      }).length;
      statsEl.textContent = coupons.length + ' קודים · ' + active + ' פעילים';
    }
    listEl.innerHTML = coupons
      .map(function (row) {
        var status = statusLabel(row);
        var live = row.active !== false && !isExpiredRow(row);
        var meta = formatDiscount(row);
        if (row.min_purchase > 0) meta += ' · מ־₪' + row.min_purchase;
        var scope = formatScope(row);
        if (scope) meta += ' · ' + scope;
        if (row.expires) meta += ' · בתוקף עד ' + row.expires;
        if (row.note) meta += ' · ' + row.note;
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
          (live ? ' admin-card__badge--sent' : ' admin-card__badge--draft') +
          '">' +
          status +
          '</span>' +
          '</div>' +
          '<p class="admin-card__meta">' +
          escapeHtml(meta) +
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
    return Promise.all([api('GET'), loadProducts().catch(function () {
      products = [];
    })]).then(function (results) {
      var data = results[0];
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
  if (appliesToInput) {
    appliesToInput.addEventListener('change', syncScopeFields);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      resetForm();
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var payload = validateBeforeSave();
    if (!payload) return;
    show(formMessage, 'שומרת…', 'info');
    api('POST', payload)
      .then(function () {
        show(formMessage, 'נשמר', 'ok');
        return loadBoard();
      })
      .catch(function (err) {
        show(formMessage, err.message || 'שמירה נכשלה', 'error');
        var el = fieldEl(err && err.field);
        if (el && el.focus) el.focus();
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
  syncScopeFields();
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
