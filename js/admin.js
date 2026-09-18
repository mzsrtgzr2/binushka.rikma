/**
 * Store backoffice: login, list, create / update / delete products, stock flags.
 */
(function () {
  var loginForm = document.getElementById('admin-login');
  var loginMessage = document.getElementById('admin-login-message');
  var board = document.getElementById('admin-board');
  var boardMessage = document.getElementById('admin-board-message');
  var listView = document.getElementById('admin-list-view');
  var listEl = document.getElementById('admin-list');
  var saveBtn = document.getElementById('admin-save');
  var newBtn = document.getElementById('admin-new');
  var logoutBtn = document.getElementById('admin-logout');
  var editor = document.getElementById('admin-editor');
  var editorTitle = document.getElementById('admin-editor-title');
  var editorMessage = document.getElementById('admin-editor-message');
  var editorSave = document.getElementById('admin-editor-save');
  var editorCancel = document.getElementById('admin-editor-cancel');
  var editorDelete = document.getElementById('admin-editor-delete');
  var variantsEl = document.getElementById('admin-variants');
  var addVariantBtn = document.getElementById('admin-add-variant');
  var slugInput = document.getElementById('admin-slug');
  var kindSelect = document.getElementById('admin-kind');
  if (!loginForm || !board || !editor) return;

  var products = [];
  var original = {};
  var editingNew = false;
  var saveHint = '';

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

  function kindLabel(p) {
    if (p.kind === 'variable') return 'גיפט קארד';
    if (p.kind === 'variants') return 'כמה סוגים';
    if (p.kind === 'fixed') return 'מחיר קבוע';
    return 'דף בלי סל';
  }

  function priceLabel(p) {
    if (p.kind === 'variable') {
      if (p.min_price && p.max_price) return '₪' + p.min_price + ' – ₪' + p.max_price;
      return 'סכום לבחירה';
    }
    if (p.kind === 'variants' && p.variants && p.variants.length) {
      var prices = p.variants.map(function (v) {
        return Number(v.price);
      }).filter(function (n) {
        return n > 0;
      });
      if (!prices.length) return '';
      var min = Math.min.apply(null, prices);
      var max = Math.max.apply(null, prices);
      return min === max ? '₪' + min : '₪' + min + ' – ₪' + max;
    }
    if (p.cart_price > 0) return '₪' + p.cart_price;
    return p.price_display || '';
  }

  function savedMessage(data, fallback) {
    if (data && data.target === 'local') {
      return fallback || 'נשמר. רענון החנות יופיע אחרי שהאתר נבנה מחדש.';
    }
    return fallback || 'נשמר. האתר יתעדכן אחרי הבילד ב-Vercel (בדרך כלל עד דקה-שתיים).';
  }

  function render() {
    listEl.innerHTML = products
      .map(function (p) {
        var img = p.image
          ? '<img class="admin-card__thumb" src="' + escapeHtml(p.image) + '" alt="">'
          : '<span class="admin-card__thumb admin-card__thumb--empty"></span>';
        var price = priceLabel(p);
        return (
          '<li class="admin-card" data-slug="' +
          escapeHtml(p.slug) +
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
          '<p class="admin-card__meta">' +
          escapeHtml(kindLabel(p)) +
          (price ? ' · ' + escapeHtml(price) : '') +
          '</p>' +
          '<label class="admin-check"><input type="checkbox" data-flag="out_of_stock"' +
          (p.out_of_stock ? ' checked' : '') +
          '> אזל מהמלאי</label>' +
          '<label class="admin-check"><input type="checkbox" data-flag="limited_stock"' +
          (p.limited_stock ? ' checked' : '') +
          '> מלאי מוגבל</label>' +
          '<label class="admin-check"><input type="checkbox" data-flag="hide"' +
          (p.hide ? ' checked' : '') +
          '> הסתר מהחנות</label>' +
          '<button type="button" class="admin-card__edit" data-edit="' +
          escapeHtml(p.slug) +
          '">עריכה</button>' +
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
    closeEditor();
  }

  function showList() {
    editor.hidden = true;
    listView.hidden = false;
  }

  function closeEditor() {
    showList();
    show(editorMessage, '', '');
    editor.reset();
    variantsEl.innerHTML = '';
    slugInput.readOnly = false;
    kindSelect.disabled = false;
    editorDelete.hidden = true;
  }

  function variantRowHtml(row) {
    row = row || {};
    return (
      '<div class="admin-variant">' +
      '<input class="form__input" data-v="id" dir="ltr" placeholder="id" value="' +
      escapeHtml(row.id || '') +
      '">' +
      '<input class="form__input" data-v="name" placeholder="שם" value="' +
      escapeHtml(row.name || '') +
      '">' +
      '<input class="form__input" data-v="price" type="number" min="1" step="1" dir="ltr" placeholder="₪" value="' +
      escapeHtml(row.price || '') +
      '">' +
      '<input class="form__input" data-v="image" dir="ltr" placeholder="/images/..." value="' +
      escapeHtml(row.image || '') +
      '">' +
      '<input class="form__input" data-v="description" placeholder="תיאור" value="' +
      escapeHtml(row.description || '') +
      '">' +
      '<button type="button" class="admin-variant__remove" data-remove-variant>הסרה</button>' +
      '</div>'
    );
  }

  function renderVariants(rows) {
    var list = rows && rows.length ? rows : [{}];
    variantsEl.innerHTML = list.map(variantRowHtml).join('');
  }

  function readVariants() {
    return Array.prototype.map.call(variantsEl.querySelectorAll('.admin-variant'), function (row) {
      return {
        id: (row.querySelector('[data-v="id"]') || {}).value,
        name: (row.querySelector('[data-v="name"]') || {}).value,
        price: (row.querySelector('[data-v="price"]') || {}).value,
        image: (row.querySelector('[data-v="image"]') || {}).value,
        description: (row.querySelector('[data-v="description"]') || {}).value,
      };
    });
  }

  function parsePresets(raw) {
    return String(raw || '')
      .split(/[,\s]+/)
      .map(function (n) {
        return Number(n);
      })
      .filter(function (n) {
        return Number.isInteger(n) && n > 0;
      });
  }

  function syncKindFields() {
    var kind = kindSelect.value;
    document.querySelectorAll('[data-kind-fields]').forEach(function (el) {
      el.hidden = el.getAttribute('data-kind-fields') !== kind;
    });
  }

  function fillEditor(product, isNew) {
    editingNew = Boolean(isNew);
    editorTitle.textContent = isNew ? 'מוצר חדש' : 'עריכת ' + (product.title || product.slug);
    slugInput.value = product.slug || '';
    slugInput.readOnly = !isNew;
    document.getElementById('admin-title').value = product.title || '';
    document.getElementById('admin-subtitle').value = product.subtitle || '';
    document.getElementById('admin-image').value = product.image || '';
    kindSelect.value = product.kind || 'fixed';
    kindSelect.disabled = product.slug === 'gift-card' || product.slug === 'scrunchies';
    document.getElementById('admin-cart-price').value = product.cart_price > 0 ? product.cart_price : '';
    document.getElementById('admin-morning-id').value = product.morning_item_id || '';
    document.getElementById('admin-min-price').value = product.min_price > 0 ? product.min_price : '';
    document.getElementById('admin-max-price').value = product.max_price > 0 ? product.max_price : '';
    document.getElementById('admin-presets').value = (product.presets || []).join(', ');
    document.getElementById('admin-body').value = product.body || '';
    document.getElementById('admin-out-of-stock').checked = Boolean(product.out_of_stock);
    document.getElementById('admin-limited-stock').checked = Boolean(product.limited_stock);
    document.getElementById('admin-hide').checked = Boolean(product.hide);
    renderVariants(product.variants);
    editorDelete.hidden = isNew;
    syncKindFields();
    show(editorMessage, '', '');
  }

  function readEditor() {
    return {
      slug: slugInput.value.trim().toLowerCase(),
      title: document.getElementById('admin-title').value,
      subtitle: document.getElementById('admin-subtitle').value,
      image: document.getElementById('admin-image').value,
      kind: kindSelect.value,
      cart_price: document.getElementById('admin-cart-price').value,
      morning_item_id: document.getElementById('admin-morning-id').value,
      min_price: document.getElementById('admin-min-price').value,
      max_price: document.getElementById('admin-max-price').value,
      presets: parsePresets(document.getElementById('admin-presets').value),
      variants: readVariants(),
      body: document.getElementById('admin-body').value,
      out_of_stock: document.getElementById('admin-out-of-stock').checked,
      limited_stock: document.getElementById('admin-limited-stock').checked,
      hide: document.getElementById('admin-hide').checked,
    };
  }

  function loadBoard() {
    return api('GET').then(function (data) {
      products = data.products || [];
      original = snapshot(products);
      showBoard();
      showList();
      render();
      if (saveHint) {
        show(boardMessage, saveHint, 'ok');
        saveHint = '';
      } else {
        show(boardMessage, '', '');
      }
    });
  }

  function saveStock() {
    saveBtn.disabled = true;
    show(boardMessage, 'שומרת…', 'info');
    return api('POST', { action: 'save', products: products }).then(function (data) {
      original = snapshot(products);
      render();
      var n = (data.changed || []).length;
      var msg =
        n === 0
          ? 'אין שינויים לשמור'
          : savedMessage(data);
      show(boardMessage, msg, n === 0 ? 'info' : 'ok');
      return data;
    });
  }

  function openEditor(isNew, product) {
    var go = function () {
      fillEditor(product || { kind: 'fixed', variants: [] }, isNew);
      listView.hidden = true;
      editor.hidden = false;
      window.scrollTo(0, 0);
    };
    if (isDirty()) {
      return saveStock()
        .then(go)
        .catch(function (err) {
          show(boardMessage, err.message || 'לא הצלחנו לשמור מלאי לפני העריכה', 'error');
        });
    }
    go();
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

  listEl.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-edit]');
    if (!btn) return;
    var product = products.find(function (p) {
      return p.slug === btn.getAttribute('data-edit');
    });
    if (product) openEditor(false, product);
  });

  saveBtn.addEventListener('click', function () {
    saveStock().catch(function (err) {
      show(boardMessage, err.message || 'לא הצלחנו לשמור', 'error');
      saveBtn.disabled = !isDirty();
    });
  });

  newBtn.addEventListener('click', function () {
    openEditor(true, { kind: 'fixed', variants: [{}] });
  });

  kindSelect.addEventListener('change', syncKindFields);

  slugInput.addEventListener('input', function () {
    if (slugInput.readOnly) return;
    slugInput.value = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  });

  addVariantBtn.addEventListener('click', function () {
    variantsEl.insertAdjacentHTML('beforeend', variantRowHtml({}));
  });

  variantsEl.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-remove-variant]');
    if (!btn) return;
    var row = btn.closest('.admin-variant');
    if (row) row.remove();
    if (!variantsEl.querySelector('.admin-variant')) renderVariants([{}]);
  });

  editor.addEventListener('submit', function (event) {
    event.preventDefault();
    editorSave.disabled = true;
    show(editorMessage, 'שומרת…', 'info');
    api('POST', { action: 'upsert', isNew: editingNew, product: readEditor() })
      .then(function (data) {
        saveHint = savedMessage(data, editingNew ? 'המוצר נוסף.' : 'המוצר עודכן.');
        if (data.target === 'local') {
          saveHint += ' רענון החנות יופיע אחרי שהאתר נבנה מחדש.';
        } else {
          saveHint += ' האתר יתעדכן אחרי הבילד ב-Vercel.';
        }
        return loadBoard();
      })
      .catch(function (err) {
        show(editorMessage, err.message || 'לא הצלחנו לשמור', 'error');
      })
      .finally(function () {
        editorSave.disabled = false;
      });
  });

  editorCancel.addEventListener('click', function () {
    closeEditor();
    render();
  });

  editorDelete.addEventListener('click', function () {
    var slug = slugInput.value.trim();
    var title = document.getElementById('admin-title').value || slug;
    if (!window.confirm('למחוק את "' + title + '"? זה מוחק את הדף ואת המוצר מהסל.')) return;
    editorDelete.disabled = true;
    show(editorMessage, 'מוחקת…', 'info');
    api('POST', { action: 'delete', slug: slug })
      .then(function (data) {
        saveHint = savedMessage(data, 'המוצר נמחק.');
        return loadBoard();
      })
      .catch(function (err) {
        show(editorMessage, err.message || 'לא הצלחנו למחוק', 'error');
      })
      .finally(function () {
        editorDelete.disabled = false;
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
