/**
 * Store backoffice: login, list, create / update / delete products,
 * shop stock, and workshop spots.
 */
(function () {
  var loginForm = document.getElementById('admin-login');
  var loginMessage = document.getElementById('admin-login-message');
  var board = document.getElementById('admin-board');
  var boardMessage = document.getElementById('admin-board-message');
  var listView = document.getElementById('admin-list-view');
  var listEl = document.getElementById('admin-list');
  var workshopsEl = document.getElementById('admin-workshops');
  var workshopsHeading = document.getElementById('admin-workshops-heading');
  var workshopsHint = document.getElementById('admin-workshops-hint');
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
  var photosEl = document.getElementById('admin-photos');
  var photoFiles = document.getElementById('admin-photo-files');
  var photosMessage = document.getElementById('admin-photos-message');
  var previewCard = document.getElementById('admin-preview-card');
  var previewPage = document.getElementById('admin-preview-page');
  if (!loginForm || !board || !editor || !photosEl) return;

  var products = [];
  var workshops = [];
  var original = {};
  var originalWorkshops = {};
  var editingNew = false;
  var saveHint = '';
  var photoItems = [];
  var variantPhotos = new WeakMap();
  var previewTimer;
  var MAX_VARIANT_PHOTOS = 8;

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

  function statusErrorMessage(status) {
    if (status === 413) return 'הבקשה גדולה מדי — נסי להקטין תמונות או להעלות פחות בבת אחת';
    if (status === 401) return 'צריך להתחבר מחדש';
    if (status === 502 || status === 503) return 'השרת לא הצליח לשמור כרגע. נסי שוב בעוד רגע';
    if (status >= 500) return 'שגיאת שרת בשמירה. נסי שוב בעוד רגע';
    return 'לא הצלחנו לשמור. בדקי את השדות וניסי שוב';
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
          var err = new Error(data.error || statusErrorMessage(res.status));
          err.field = data.field || null;
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function clearFieldErrors() {
    if (!editor) return;
    Array.prototype.forEach.call(editor.querySelectorAll('.form__input--error'), function (el) {
      el.classList.remove('form__input--error');
      el.removeAttribute('aria-invalid');
    });
    Array.prototype.forEach.call(editor.querySelectorAll('[data-field-error]'), function (el) {
      el.hidden = true;
      el.textContent = '';
    });
  }

  function setFieldError(el, message) {
    if (!el || !message) return;
    el.classList.add('form__input--error');
    el.setAttribute('aria-invalid', 'true');
    var group = el.closest('.form__group') || el.parentElement;
    if (!group) return;
    var msg = group.querySelector('[data-field-error]');
    if (!msg) {
      msg = document.createElement('p');
      msg.className = 'admin-field-error';
      msg.setAttribute('data-field-error', '');
      group.appendChild(msg);
    }
    msg.textContent = message;
    msg.hidden = false;
  }

  function focusField(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      el.scrollIntoView(true);
    }
    window.setTimeout(function () {
      try {
        el.focus({ preventScroll: true });
      } catch (e2) {
        try {
          el.focus();
        } catch (e3) {}
      }
    }, 80);
  }

  function fieldEl(name) {
    if (name === 'slug') return slugInput;
    if (name === 'title') return document.getElementById('admin-title');
    if (name === 'cart_price') return document.getElementById('admin-cart-price');
    if (name === 'min_price') return document.getElementById('admin-min-price');
    if (name === 'max_price') return document.getElementById('admin-max-price');
    if (name === 'stock') return document.getElementById('admin-stock');
    if (name === 'category') return document.getElementById('admin-category');
    if (name === 'photos') return photoFiles || photosEl;
    if (name === 'variants') {
      return (variantsEl && variantsEl.querySelector('[data-v="price"]')) || addVariantBtn || variantsEl;
    }
    return null;
  }

  function inferFieldFromMessage(message) {
    var msg = String(message || '');
    if (/מזהה מוצר|כבר יש מוצר עם המזהה|מוצר לא מוכר/.test(msg)) return 'slug';
    if (/חסר שם/.test(msg)) return 'title';
    if (/סוג אחד עם מחיר|תמונות לכל סוג/.test(msg)) return 'variants';
    if (/גיפט קארד|סכום/.test(msg)) return 'min_price';
    if (/מחיר לא תקין/.test(msg)) return 'cart_price';
    if (/מלאי/.test(msg)) return 'stock';
    if (/קטגוריה/.test(msg)) return 'category';
    if (/תמונ|jpg|png|webp|gif/.test(msg)) return 'photos';
    return null;
  }

  function showEditorError(message, field) {
    var text = message || 'לא הצלחנו לשמור';
    var target = fieldEl(field) || fieldEl(inferFieldFromMessage(text));
    clearFieldErrors();
    show(editorMessage, text, 'error');
    if (target) {
      setFieldError(target, text);
      focusField(target);
    }
  }

  function validateEditor() {
    var errors = [];
    var slug = slugInput.value.trim().toLowerCase();
    if (!slug) {
      errors.push({ el: slugInput, message: 'חסר מזהה מוצר' });
    } else if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      errors.push({
        el: slugInput,
        message: 'מזהה מוצר לא תקין (באנגלית, אותיות קטנות ומקפים)',
      });
    }

    var titleEl = document.getElementById('admin-title');
    if (!titleEl.value.trim()) {
      errors.push({ el: titleEl, message: 'חסר שם למוצר' });
    }

    var kind = kindSelect.value;
    if (kind === 'fixed') {
      var cartPriceEl = document.getElementById('admin-cart-price');
      if (!(Number(cartPriceEl.value) > 0)) {
        errors.push({ el: cartPriceEl, message: 'יש להזין מחיר גדול מ-0' });
      }
    }

    if (kind === 'variable') {
      var minEl = document.getElementById('admin-min-price');
      var maxEl = document.getElementById('admin-max-price');
      var min = Number(minEl.value);
      var max = Number(maxEl.value);
      if (!(min > 0)) {
        errors.push({ el: minEl, message: 'סכום מינימום חייב להיות גדול מ-0' });
      }
      if (!(max >= min) || !(max > 0)) {
        errors.push({ el: maxEl, message: 'סכום מקסימום חייב להיות לפחות כמו המינימום' });
      }
    }

    if (kind === 'variants') {
      var rows = variantsEl.querySelectorAll('.admin-variant');
      var pricedCount = 0;
      Array.prototype.forEach.call(rows, function (row, index) {
        var priceInput = row.querySelector('[data-v="price"]');
        var nameInput = row.querySelector('[data-v="name"]');
        var priceRaw = priceInput ? String(priceInput.value || '').trim() : '';
        var name = nameInput ? String(nameInput.value || '').trim() : '';
        var price = Number(priceRaw);
        var label = 'סוג ' + (index + 1);
        if (priceRaw !== '' && !(price > 0)) {
          errors.push({
            el: priceInput,
            message: label + ': המחיר חייב להיות מספר שלם גדול מ-0',
          });
        } else if (price > 0) {
          pricedCount += 1;
        } else if (name) {
          errors.push({
            el: priceInput,
            message: label + ': חסר מחיר (חייב להיות גדול מ-0)',
          });
        }
      });
      if (!pricedCount) {
        var firstPrice = variantsEl.querySelector('[data-v="price"]');
        var already = errors.some(function (item) {
          return item.el === firstPrice;
        });
        if (!already) {
          errors.push({
            el: firstPrice || addVariantBtn,
            message: 'צריך לפחות סוג אחד עם מחיר גדול מ-0',
          });
        }
      }
    }

    var stockEl = document.getElementById('admin-stock');
    if (
      stockEl &&
      !stockEl.disabled &&
      String(stockEl.value || '').trim() !== ''
    ) {
      var stock = Number(stockEl.value);
      if (!Number.isInteger(stock) || stock < 0 || stock > 99999) {
        errors.push({ el: stockEl, message: 'כמות מלאי לא תקינה (0–99999)' });
      }
    }

    return errors;
  }

  function applyValidationErrors(errors) {
    clearFieldErrors();
    if (!errors.length) return;
    errors.forEach(function (item) {
      setFieldError(item.el, item.message);
    });
    var first = errors[0];
    var summary =
      errors.length === 1
        ? first.message
        : 'יש ' + errors.length + ' בעיות לתיקון. הראשונה: ' + first.message;
    show(editorMessage, summary, 'error');
    focusField(first.el);
  }

  function snapshot(list) {
    var map = {};
    (list || []).forEach(function (p) {
      map[p.slug] = {
        out_of_stock: Boolean(p.out_of_stock),
        limited_stock: Boolean(p.limited_stock),
        hide: Boolean(p.hide),
        stock: p.stock == null || p.stock === '' ? null : Number(p.stock),
      };
    });
    return map;
  }

  function snapshotWorkshops(list) {
    var map = {};
    (list || []).forEach(function (w) {
      map[w.slug] = {
        registration_full: Boolean(w.registration_full),
        hide: Boolean(w.hide),
        spots: w.spots == null || w.spots === '' ? null : Number(w.spots),
      };
    });
    return map;
  }

  function isDirty() {
    var productsDirty = products.some(function (p) {
      var orig = original[p.slug] || {};
      var stock = p.stock == null || p.stock === '' ? null : Number(p.stock);
      var origStock = orig.stock == null || orig.stock === '' ? null : Number(orig.stock);
      return (
        Boolean(p.out_of_stock) !== Boolean(orig.out_of_stock) ||
        Boolean(p.limited_stock) !== Boolean(orig.limited_stock) ||
        Boolean(p.hide) !== Boolean(orig.hide) ||
        stock !== origStock
      );
    });
    if (productsDirty) return true;
    return workshops.some(function (w) {
      var orig = originalWorkshops[w.slug] || {};
      var spots = w.spots == null || w.spots === '' ? null : Number(w.spots);
      var origSpots = orig.spots == null || orig.spots === '' ? null : Number(orig.spots);
      return (
        Boolean(w.registration_full) !== Boolean(orig.registration_full) ||
        Boolean(w.hide) !== Boolean(orig.hide) ||
        spots !== origSpots
      );
    });
  }

  function statusLabel(p) {
    if (p.hide) return 'מוסתר';
    if (p.out_of_stock || p.stock === 0) return 'אזל';
    if (p.stock != null && p.stock !== '') return 'מלאי: ' + p.stock;
    if (p.limited_stock) return 'מלאי מוגבל';
    return 'במלאי';
  }

  function workshopStatusLabel(w) {
    if (w.hide) return 'מוסתרת';
    if (w.registration_full || w.spots === 0) return 'מלאה';
    if (w.spots != null && w.spots !== '') return 'מקומות: ' + w.spots;
    if (w.registration_not_open) return 'הרשמה סגורה';
    return 'פתוחה';
  }

  function kindLabel(p) {
    if (p.kind === 'variable') return 'גיפט קארד';
    if (p.kind === 'variants') return 'כמה סוגים';
    if (p.kind === 'fixed') return 'מחיר קבוע';
    return 'דף בלי סל';
  }

  function categoryLabel(p) {
    if (p.category === 'embroidery-supplies') return 'ציוד רקמה';
    if (p.category === 'works-for-sale') return 'עבודות למכירה';
    return '';
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
          (categoryLabel(p) ? ' · ' + escapeHtml(categoryLabel(p)) : '') +
          (price ? ' · ' + escapeHtml(price) : '') +
          '</p>' +
          '<label class="admin-stock">כמות במלאי' +
          '<input type="number" class="admin-stock__input" data-stock min="0" step="1" dir="ltr" ' +
          'placeholder="—"' +
          (p.stock != null && p.stock !== '' ? ' value="' + escapeHtml(p.stock) + '"' : '') +
          (p.kind === 'variable' || p.kind === 'content' ? ' disabled' : '') +
          '></label>' +
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
    if (workshopsEl) {
      workshopsEl.innerHTML = workshops
        .map(function (w) {
          var img = w.image
            ? '<img class="admin-card__thumb" src="' + escapeHtml(w.image) + '" alt="">'
            : '<span class="admin-card__thumb admin-card__thumb--empty"></span>';
          var price = '';
          if (w.variants) {
            var packPrices = Object.keys(w.variants)
              .map(function (id) {
                return Number(w.variants[id] && w.variants[id].price);
              })
              .filter(function (n) {
                return n > 0;
              });
            if (packPrices.length) {
              var pmin = Math.min.apply(null, packPrices);
              var pmax = Math.max.apply(null, packPrices);
              price = pmin === pmax ? '₪' + pmin : '₪' + pmin + ' – ₪' + pmax;
            }
          } else if (w.price > 0) {
            price = '₪' + w.price;
          }
          var meta = ['סדנה'];
          if (w.subtitle) meta.push(w.subtitle);
          if (price) meta.push(price);
          return (
            '<li class="admin-card" data-workshop-slug="' +
            escapeHtml(w.slug) +
            '">' +
            img +
            '<div class="admin-card__body">' +
            '<div class="admin-card__head">' +
            '<strong>' +
            escapeHtml(w.title) +
            '</strong>' +
            '<span class="admin-card__badge">' +
            workshopStatusLabel(w) +
            '</span>' +
            '</div>' +
            '<p class="admin-card__meta">' +
            escapeHtml(meta.join(' · ')) +
            '</p>' +
            '<label class="admin-stock">מקומות פנויים' +
            '<input type="number" class="admin-stock__input" data-workshop-spots min="0" step="1" dir="ltr" ' +
            'placeholder="—"' +
            (w.spots != null && w.spots !== '' ? ' value="' + escapeHtml(w.spots) + '"' : '') +
            '></label>' +
            '<label class="admin-check"><input type="checkbox" data-workshop-flag="registration_full"' +
            (w.registration_full ? ' checked' : '') +
            '> ההרשמה מלאה</label>' +
            '<label class="admin-check"><input type="checkbox" data-workshop-flag="hide"' +
            (w.hide ? ' checked' : '') +
            '> הסתר מהאתר</label>' +
            '</div></li>'
          );
        })
        .join('');
    }
    if (workshopsHeading) workshopsHeading.hidden = workshops.length === 0;
    if (workshopsHint) workshopsHint.hidden = workshops.length === 0;
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
    workshops = [];
    originalWorkshops = {};
    closeEditor();
  }

  function showList() {
    editor.hidden = true;
    listView.hidden = false;
  }

  function closeEditor() {
    showList();
    show(editorMessage, '', '');
    show(photosMessage, '', '');
    editor.reset();
    editor.classList.remove('admin-editor--variants');
    variantsEl.innerHTML = '';
    photoItems = [];
    renderPhotos();
    slugInput.readOnly = false;
    kindSelect.disabled = false;
    editorDelete.hidden = true;
  }

  function variantImageSrc(image) {
    if (!image) return '';
    if (typeof image === 'string') return image;
    if (image.preview) return image.preview;
    if (image.upload && image.upload.data) return image.upload.data;
    if (image.path) return image.path;
    return '';
  }

  function variantImagesFromRow(row) {
    row = row || {};
    if (row.images && row.images.length) {
      return row.images.map(function (item) {
        if (typeof item === 'string') return { path: item, preview: item };
        return item;
      });
    }
    var list = [];
    if (row.image) {
      if (typeof row.image === 'string') list.push({ path: row.image, preview: row.image });
      else list.push(row.image);
    }
    (row.gallery || []).forEach(function (pathName) {
      list.push({ path: pathName, preview: pathName });
    });
    return list;
  }

  function variantPhotosHtml(items) {
    if (!items || !items.length) {
      return '<p class="admin-hint admin-variant__photos-empty">עדיין אין תמונות לסוג הזה.</p>';
    }
    return (
      '<div class="admin-variant__photos">' +
      items
        .map(function (item, i) {
          var src = item.preview || item.path || '';
          return (
            '<article class="admin-variant__photo' +
            (i === 0 ? ' admin-variant__photo--main' : '') +
            '">' +
            (src
              ? '<img class="admin-variant__thumb" src="' + escapeHtml(src) + '" alt="">'
              : '<span class="admin-variant__thumb admin-variant__thumb--empty" aria-hidden="true"></span>') +
            (i === 0 ? '<span class="admin-variant__photo-badge">ראשית</span>' : '') +
            '<button type="button" class="admin-variant__photo-remove" data-variant-photo-remove="' +
            i +
            '">הסרה</button>' +
            '</article>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function variantRowHtml(row, index) {
    row = row || {};
    var n = (index == null ? 0 : index) + 1;
    var images = variantImagesFromRow(row);
    return (
      '<div class="admin-variant">' +
      '<div class="admin-variant__heading">' +
      '<p class="admin-variant__label">סוג ' +
      n +
      '</p>' +
      '<button type="button" class="admin-variant__remove" data-remove-variant>הסרת סוג</button>' +
      '</div>' +
      '<div class="form__group">' +
      '<label class="form__label">שם הסוג</label>' +
      '<input class="form__input" data-v="name" placeholder="למשל: קטיפה אדומה" value="' +
      escapeHtml(row.name || '') +
      '">' +
      '</div>' +
      '<div class="admin-grid">' +
      '<div class="form__group">' +
      '<label class="form__label">מחיר (₪)</label>' +
      '<input class="form__input" data-v="price" type="number" min="1" step="1" dir="ltr" placeholder="30" value="' +
      escapeHtml(row.price || '') +
      '">' +
      '</div>' +
      '<div class="form__group">' +
      '<label class="form__label">מזהה פנימי</label>' +
      '<input class="form__input" data-v="id" dir="ltr" placeholder="regular" value="' +
      escapeHtml(row.id || '') +
      '">' +
      '<p class="admin-hint">אופציונלי. באנגלית בלבד — אם ריק נייצר אוטומטית.</p>' +
      '</div>' +
      '</div>' +
      '<div class="form__group">' +
      '<label class="form__label">תיאור</label>' +
      '<textarea class="form__input admin-body-input admin-variant__description" data-v="description" rows="12" placeholder="תיאור מלא לסוג — אפשר לכתוב טקסט ארוך בכמה שורות">' +
      escapeHtml(row.description || '') +
      '</textarea>' +
      '</div>' +
      '<div class="form__group admin-variant__image-group">' +
      '<label class="form__label">תמונות</label>' +
      '<p class="admin-hint">אפשר כמה תמונות לכל סוג. הראשונה מוצגת כראשית בסל ובכרטיס.</p>' +
      '<div class="admin-variant__image" data-variant-photos>' +
      variantPhotosHtml(images) +
      '<div class="admin-variant__image-actions">' +
      '<label class="button admin-upload-btn">' +
      'העלאת תמונות' +
      '<input type="file" data-v-image-file accept="image/jpeg,image/png,image/webp,image/gif" multiple>' +
      '</label>' +
      '</div></div></div></div>'
    );
  }

  function getVariantPhotoItems(row) {
    if (!variantPhotos.has(row)) variantPhotos.set(row, []);
    return variantPhotos.get(row);
  }

  function renderVariantPhotos(row) {
    var box = row.querySelector('[data-variant-photos]');
    if (!box) return;
    var actions = box.querySelector('.admin-variant__image-actions');
    var listHtml = variantPhotosHtml(getVariantPhotoItems(row));
    var tmp = document.createElement('div');
    tmp.innerHTML = listHtml;
    Array.prototype.slice
      .call(box.querySelectorAll('.admin-variant__photos, .admin-variant__photos-empty'))
      .forEach(function (el) {
        el.remove();
      });
    while (tmp.firstChild) {
      box.insertBefore(tmp.firstChild, actions);
    }
  }

  function renderVariants(rows) {
    var list = rows && rows.length ? rows : [{}];
    variantsEl.innerHTML = list
      .map(function (row, index) {
        return variantRowHtml(row, index);
      })
      .join('');
    Array.prototype.forEach.call(variantsEl.querySelectorAll('.admin-variant'), function (el, index) {
      variantPhotos.set(el, variantImagesFromRow(list[index] || {}));
    });
  }

  function renumberVariants() {
    Array.prototype.forEach.call(variantsEl.querySelectorAll('.admin-variant'), function (row, index) {
      var label = row.querySelector('.admin-variant__label');
      if (label) label.textContent = 'סוג ' + (index + 1);
    });
  }

  function readVariantImages(row) {
    return getVariantPhotoItems(row).map(function (item) {
      if (item.upload) return { upload: item.upload };
      return { path: item.path };
    });
  }

  function readVariants() {
    return Array.prototype.map.call(variantsEl.querySelectorAll('.admin-variant'), function (row) {
      var images = readVariantImages(row);
      return {
        id: (row.querySelector('[data-v="id"]') || {}).value,
        name: (row.querySelector('[data-v="name"]') || {}).value,
        price: (row.querySelector('[data-v="price"]') || {}).value,
        images: images,
        image: images[0] || '',
        gallery: images.slice(1),
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

  function renderPhotos() {
    if (!photoItems.length) {
      photosEl.innerHTML = '<p class="admin-hint">עדיין אין תמונות. הוסיפי קבצים מהמחשב.</p>';
      schedulePreview();
      return;
    }
    photosEl.innerHTML = photoItems
      .map(function (item, i) {
        var src = item.preview || item.path || '';
        return (
          '<article class="admin-photo' +
          (i === 0 ? ' admin-photo--main' : '') +
          '">' +
          (src
            ? '<img class="admin-photo__img" src="' + escapeHtml(src) + '" alt="">'
            : '<span class="admin-photo__img admin-photo__img--empty"></span>') +
          (i === 0 ? '<span class="admin-photo__badge">מרכזית</span>' : '') +
          '<div class="admin-photo__actions">' +
          (i === 0
            ? ''
            : '<button type="button" class="admin-photo__btn" data-photo-main="' +
              i +
              '">הפוך למרכזית</button>') +
          '<button type="button" class="admin-photo__btn" data-photo-up="' +
          i +
          '"' +
          (i === 0 ? ' disabled' : '') +
          '>ימינה</button>' +
          '<button type="button" class="admin-photo__btn" data-photo-down="' +
          i +
          '"' +
          (i === photoItems.length - 1 ? ' disabled' : '') +
          '>שמאלה</button>' +
          '<button type="button" class="admin-photo__btn admin-photo__btn--danger" data-photo-remove="' +
          i +
          '">הסרה</button>' +
          '</div></article>'
        );
      })
      .join('');
    schedulePreview();
  }

  function movePhoto(from, to) {
    if (to < 0 || to >= photoItems.length) return;
    var item = photoItems.splice(from, 1)[0];
    photoItems.splice(to, 0, item);
    renderPhotos();
  }

  function readFileAsPhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.type)) {
        reject(new Error('רק jpg, png, webp או gif'));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error('לא הצלחנו לקרוא את הקובץ'));
      };
      reader.onload = function () {
        var dataUrl = String(reader.result || '');
        var finish = function (data, mime, filename) {
          if (data.length > 3500000) {
            reject(new Error('תמונה גדולה מדי (עד 2.5MB אחרי דחיסה)'));
            return;
          }
          resolve({
            path: '',
            preview: data,
            upload: { filename: filename, mime: mime, data: data },
          });
        };
        // Keep small files and animated GIFs as-is. Large still images are
        // re-encoded as JPEG — canvas PNG export ignores quality and stays huge.
        if (file.type === 'image/gif' || file.size < 900000) {
          finish(dataUrl, file.type, file.name);
          return;
        }
        var img = new Image();
        img.onload = function () {
          var max = 1600;
          var w = img.width;
          var h = img.height;
          if (w > max || h > max) {
            var scale = Math.min(max / w, max / h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          var mime = 'image/jpeg';
          var qualities = [0.82, 0.7, 0.55, 0.4];
          var compressed = '';
          for (var i = 0; i < qualities.length; i++) {
            compressed = canvas.toDataURL(mime, qualities[i]);
            if (compressed.length <= 3500000) break;
          }
          var filename = String(file.name || 'photo').replace(/\.[^.]+$/, '.jpg');
          finish(compressed, mime, filename);
        };
        img.onerror = function () {
          reject(new Error('לא הצלחנו לעבד את התמונה'));
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  function syncKindFields() {
    var kind = kindSelect.value;
    document.querySelectorAll('[data-kind-fields]').forEach(function (el) {
      el.hidden = el.getAttribute('data-kind-fields') !== kind;
    });
    editor.classList.toggle('admin-editor--variants', kind === 'variants');
    var stockInput = document.getElementById('admin-stock');
    if (stockInput) {
      stockInput.disabled = kind === 'variable' || kind === 'content' || slugInput.value === 'gift-card';
    }
  }

  /** Quantity drives «אזל מהמלאי»: 0 → on, >0 → off; empty/untracked leaves the flag alone. */
  function syncEditorOutOfStock(stock, fallback) {
    var box = document.getElementById('admin-out-of-stock');
    if (!box) return;
    if (stock === 0 || stock === '0') box.checked = true;
    else if (stock != null && stock !== '' && Number(stock) > 0) box.checked = false;
    else if (fallback != null) box.checked = Boolean(fallback);
  }

  function fillEditor(product, isNew) {
    editingNew = Boolean(isNew);
    editorTitle.textContent = isNew ? 'מוצר חדש' : 'עריכת ' + (product.title || product.slug);
    slugInput.value = product.slug || '';
    slugInput.readOnly = !isNew;
    document.getElementById('admin-title').value = product.title || '';
    document.getElementById('admin-subtitle').value = product.subtitle || '';
    photoItems = (product.photos && product.photos.length ? product.photos : product.image ? [product.image] : []).map(
      function (pathName) {
        return { path: pathName, preview: pathName };
      }
    );
    renderPhotos();
    kindSelect.value = product.kind || 'fixed';
    kindSelect.disabled = product.slug === 'gift-card' || product.slug === 'scrunchies';
    document.getElementById('admin-category').value = product.category || '';
    document.getElementById('admin-cart-price').value = product.cart_price > 0 ? product.cart_price : '';
    document.getElementById('admin-min-price').value = product.min_price > 0 ? product.min_price : '';
    document.getElementById('admin-max-price').value = product.max_price > 0 ? product.max_price : '';
    document.getElementById('admin-presets').value = (product.presets || []).join(', ');
    document.getElementById('admin-body').value = product.body || '';
    document.getElementById('admin-stock').value =
      product.stock != null && product.stock !== '' ? product.stock : '';
    document.getElementById('admin-stock').disabled =
      product.kind === 'variable' || product.kind === 'content' || product.slug === 'gift-card';
    syncEditorOutOfStock(product.stock, Boolean(product.out_of_stock));
    document.getElementById('admin-limited-stock').checked = Boolean(product.limited_stock);
    document.getElementById('admin-hide').checked = Boolean(product.hide);
    renderVariants(product.variants);
    editorDelete.hidden = isNew;
    syncKindFields();
    clearFieldErrors();
    show(editorMessage, '', '');
    show(photosMessage, '', '');
    updatePreview();
  }

  function readEditor() {
    var kind = kindSelect.value;
    var stockRaw = document.getElementById('admin-stock').value;
    var stock =
      kind === 'variable' || kind === 'content' || slugInput.value.trim().toLowerCase() === 'gift-card'
        ? null
        : stockRaw;
    var outOfStock = document.getElementById('admin-out-of-stock').checked;
    if (stock === 0 || stock === '0') outOfStock = true;
    else if (stock != null && stock !== '' && Number(stock) > 0) outOfStock = false;
    return {
      slug: slugInput.value.trim().toLowerCase(),
      title: document.getElementById('admin-title').value,
      subtitle: document.getElementById('admin-subtitle').value,
      photos: photoItems.map(function (item) {
        if (item.upload) return { upload: item.upload };
        return { path: item.path };
      }),
      kind: kind,
      category: document.getElementById('admin-category').value,
      cart_price: document.getElementById('admin-cart-price').value,
      min_price: document.getElementById('admin-min-price').value,
      max_price: document.getElementById('admin-max-price').value,
      presets: parsePresets(document.getElementById('admin-presets').value),
      variants: readVariants(),
      body: document.getElementById('admin-body').value,
      stock: stock,
      out_of_stock: outOfStock,
      limited_stock: document.getElementById('admin-limited-stock').checked,
      hide: document.getElementById('admin-hide').checked,
    };
  }

  function displayPriceFor(input) {
    if (input.kind === 'variable') return 'כל סכום לבחירתך';
    if (input.kind === 'variants') {
      var prices = (input.variants || [])
        .map(function (v) {
          return Number(v.price);
        })
        .filter(function (n) {
          return n > 0;
        });
      if (!prices.length) return '';
      var min = Math.min.apply(null, prices);
      var max = Math.max.apply(null, prices);
      return min === max ? '₪' + min : '₪' + min + ' – ₪' + max;
    }
    if (input.kind === 'content') return '';
    var n = Number(input.cart_price);
    return n > 0 ? '₪' + n : '';
  }

  function inlineMarkdown(s) {
    return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function renderMarkdown(src) {
    var text = String(src || '')
      .replace(/\r\n/g, '\n')
      .trim();
    if (!text) return '';
    return text
      .split(/\n{2,}/)
      .map(function (block) {
        var lines = block.split('\n');
        var first = lines[0] || '';
        if (/^### /.test(first)) {
          return (
            '<h3>' +
            inlineMarkdown(first.replace(/^### /, '')) +
            '</h3>' +
            (lines.length > 1 ? '<p>' + lines.slice(1).map(inlineMarkdown).join('<br>') + '</p>' : '')
          );
        }
        if (/^## /.test(first)) {
          return (
            '<h2>' +
            inlineMarkdown(first.replace(/^## /, '')) +
            '</h2>' +
            (lines.length > 1 ? '<p>' + lines.slice(1).map(inlineMarkdown).join('<br>') + '</p>' : '')
          );
        }
        if (lines.every(function (line) {
          return /^[-*] /.test(line);
        })) {
          return (
            '<ul>' +
            lines
              .map(function (line) {
                return '<li>' + inlineMarkdown(line.replace(/^[-*] /, '')) + '</li>';
              })
              .join('') +
            '</ul>'
          );
        }
        return '<p>' + lines.map(inlineMarkdown).join('<br>') + '</p>';
      })
      .join('');
  }

  function stockOverlay(p) {
    if (p.out_of_stock || p.stock === 0) return '<div class="out-of-stock">אזל מהמלאי</div>';
    if (p.limited_stock) return '<div class="limited-stock">מלאי מוגבל</div>';
    return '';
  }

  function stockText(p) {
    if (p.out_of_stock || p.stock === 0) return '<div class="out-of-stock-text">אזל מהמלאי</div>';
    if (p.limited_stock) return '<div class="limited-stock-text">מלאי מוגבל</div>';
    return '';
  }

  function fakeButton(label, extraClass) {
    return (
      '<button type="button" class="button button--primary' +
      (extraClass ? ' ' + extraClass : '') +
      '" tabindex="-1" aria-hidden="true">' +
      escapeHtml(label) +
      '</button>'
    );
  }

  function storeCardCta(p) {
    if (p.out_of_stock || p.stock === 0 || p.kind === 'content') return '';
    if (p.kind === 'variable') return fakeButton('בחרי סכום', 'store-item__add');
    if (p.kind === 'variants') return fakeButton('בחרי סוג', 'store-item__add');
    return fakeButton('הוסיפי לסל', 'store-item__add');
  }

  function variantCardsHtml(p, scrunchie) {
    return (p.variants || [])
      .filter(function (v) {
        return v.name || v.price || v.id;
      })
      .map(function (v) {
        var name = v.name || v.id || '';
        var sources = [];
        if (v.images && v.images.length) {
          v.images.forEach(function (item) {
            var src = variantImageSrc(item);
            if (src) sources.push(src);
          });
        } else {
          var main = variantImageSrc(v.image);
          if (main) sources.push(main);
          (v.gallery || []).forEach(function (pathName) {
            if (pathName) sources.push(pathName);
          });
        }
        var img = '';
        if (sources.length) {
          if (scrunchie) {
            img =
              '<div class="scrunchies-variant__photo"><img src="' +
              escapeHtml(sources[0]) +
              '" alt=""></div>' +
              (sources.length > 1
                ? '<div class="scrunchies-variant__gallery">' +
                  sources
                    .slice(1)
                    .map(function (src) {
                      return '<img src="' + escapeHtml(src) + '" alt="">';
                    })
                    .join('') +
                  '</div>'
                : '');
          } else {
            img =
              '<div class="store-variant__photos">' +
              sources
                .map(function (src) {
                  return '<img class="store-variant__photo" src="' + escapeHtml(src) + '" alt="">';
                })
                .join('') +
              '</div>';
          }
        }
        if (scrunchie) {
          return (
            '<article class="scrunchies-variant">' +
            img +
            '<h3 class="scrunchies-variant__name">' +
            escapeHtml(name) +
            '</h3>' +
            (v.description
              ? '<p class="scrunchies-variant__desc">' + escapeHtml(v.description) + '</p>'
              : '') +
            (v.price ? '<div class="scrunchies-variant__price">₪' + escapeHtml(v.price) + '</div>' : '') +
            fakeButton('הוסיפי לסל') +
            '</article>'
          );
        }
        return (
          '<article class="store-variant">' +
          img +
          '<div class="store-variant__info">' +
          '<h3 class="store-variant__name">' +
          escapeHtml(name) +
          '</h3>' +
          (v.description ? '<p class="store-variant__desc">' + escapeHtml(v.description) + '</p>' : '') +
          (v.price ? '<div class="store-variant__price">₪' + escapeHtml(v.price) + '</div>' : '') +
          '</div>' +
          fakeButton('הוסיפי לסל') +
          '</article>'
        );
      })
      .join('');
  }

  function productCartHtml(p) {
    if (p.out_of_stock || p.stock === 0 || p.kind === 'content') return '';
    if (p.kind === 'variable') {
      var chips = (p.presets || [])
        .map(function (n) {
          return '<span class="gift-amount__chip">₪' + escapeHtml(n) + '</span>';
        })
        .join('');
      return (
        '<div class="gift-amount">' +
        '<p class="gift-amount__label">בחרי סכום לגיפט קארד</p>' +
        (chips ? '<div class="gift-amount__chips">' + chips + '</div>' : '') +
        '<label class="gift-amount__custom"><span>' +
        (p.min_price || p.max_price
          ? 'או סכום אחר (₪' +
            escapeHtml(p.min_price || '') +
            '–₪' +
            escapeHtml(p.max_price || '') +
            ')'
          : 'או סכום אחר') +
        '</span><input class="form__input gift-amount__input" disabled placeholder="₪"></label>' +
        fakeButton('הוסיפי לסל', 'section-button is-preview-disabled') +
        '</div>'
      );
    }
    if (p.kind === 'variants') {
      var scrunchie = p.slug === 'scrunchies';
      var rows = variantCardsHtml(p, scrunchie);
      if (!rows) return '';
      if (scrunchie) {
        return (
          '<div class="scrunchies-variants-section">' +
          '<h2 class="scrunchies-variants-section__title">בחרי סוג</h2>' +
          '<p class="scrunchies-variants-section__subtitle">כל סקראנצ\'י תפורה בעבודת יד — בצבע ובדגם שתבחרי.</p>' +
          '<div class="scrunchies-variants">' +
          rows +
          '</div></div>'
        );
      }
      return '<div class="store-variants">' + rows + '</div>';
    }
    return fakeButton('הוסיפי לסל', 'section-button');
  }

  function galleryHtml(paths, scrunchie) {
    if (!paths || !paths.length) return '';
    if (scrunchie) {
      return (
        '<div class="scrunchies-gallery">' +
        paths
          .map(function (src) {
            return (
              '<div class="scrunchies-gallery__item"><img src="' +
              escapeHtml(src) +
              '" alt=""></div>'
            );
          })
          .join('') +
        '</div>'
      );
    }
    return (
      '<div class="store-item-gallery">' +
      paths
        .map(function (src) {
          return '<img class="store-item-gallery__img" src="' + escapeHtml(src) + '" alt="">';
        })
        .join('') +
      '</div>'
    );
  }

  function previewState() {
    var data = readEditor();
    var photos = photoItems
      .map(function (item) {
        return item.preview || item.path || '';
      })
      .filter(Boolean);
    data.image = photos[0] || '';
    data.gallery = photos.slice(1);
    data.price = displayPriceFor(data);
    return data;
  }

  function storeCardHtml(p) {
    var img = p.image
      ? '<img src="' + escapeHtml(p.image) + '" alt="">'
      : '';
    var price = p.price
      ? '<div class="store-item__price">' + escapeHtml(p.price) + '</div>'
      : '';
    var cta = storeCardCta(p);
    return (
      '<article class="store-item' +
      (p.hide ? ' is-preview-hidden' : '') +
      '">' +
      '<div class="store-item__content">' +
      '<div class="store-item__image">' +
      img +
      stockOverlay(p) +
      '</div>' +
      '<div class="store-item__info">' +
      '<h3 class="store-item__title"><span>' +
      escapeHtml(p.title || 'שם המוצר') +
      '</span></h3>' +
      (p.subtitle ? '<div class="store-item__subtitle">' + escapeHtml(p.subtitle) + '</div>' : '') +
      '<div class="store-item__footer">' +
      price +
      cta +
      '</div></div></div></article>'
    );
  }

  function productPageHtml(p) {
    var scrunchie = p.slug === 'scrunchies';
    var body = renderMarkdown(p.body);
    var cart = productCartHtml(p);
    if (scrunchie) {
      return (
        (p.image
          ? '<div class="scrunchies-hero"><img class="scrunchies-hero__bg" src="' +
            escapeHtml(p.image) +
            '" alt=""><div class="scrunchies-hero__content"><h1 class="scrunchies-hero__title">' +
            escapeHtml(p.title || 'שם המוצר') +
            '</h1>' +
            (p.subtitle
              ? '<p class="scrunchies-hero__subtitle">' + escapeHtml(p.subtitle) + '</p>'
              : '') +
            '</div></div>'
          : '<div class="page-head"><h1 class="page-title">' +
            escapeHtml(p.title || 'שם המוצר') +
            '</h1>' +
            (p.subtitle ? '<p class="store-item-subtitle">' + escapeHtml(p.subtitle) + '</p>' : '') +
            '</div>') +
        (body ? '<div class="scrunchies-story"><div class="scrunchies-story__text">' + body + '</div></div>' : '') +
        galleryHtml(p.gallery, true) +
        (cart ? '<div class="store-item-content">' + cart + '</div>' : '')
      );
    }
    var mainImage = p.image
      ? '<div class="store-item-content"><div class="page-image"><div class="store-item-image-container">' +
        '<img src="' +
        escapeHtml(p.image) +
        '" alt="">' +
        stockOverlay(p) +
        '</div></div>' +
        galleryHtml(p.gallery, false) +
        '</div>'
      : galleryHtml(p.gallery, false);
    return (
      '<div class="page-head">' +
      '<h1 class="page-title">' +
      escapeHtml(p.title || 'שם המוצר') +
      '</h1>' +
      stockText(p) +
      (p.subtitle ? '<p class="store-item-subtitle">' + escapeHtml(p.subtitle) + '</p>' : '') +
      (p.price ? '<div class="store-item-price">' + escapeHtml(p.price) + '</div>' : '') +
      '</div>' +
      (body ? '<div class="store-item-content admin-preview__markdown">' + body + '</div>' : '') +
      (cart ? '<div class="store-item-content"><div class="store-item__cart-actions">' + cart + '</div></div>' : '') +
      mainImage
    );
  }

  function updatePreview() {
    if (!previewCard || !previewPage || editor.hidden) return;
    var p = previewState();
    var hiddenNote = p.hide
      ? '<p class="admin-preview__hidden">מוסתר מהחנות — הלקוחות לא יראו את המוצר ברשימה</p>'
      : '';
    previewCard.innerHTML =
      '<h3 class="admin-preview__label">בחנות</h3>' + hiddenNote + storeCardHtml(p);
    previewPage.innerHTML =
      '<h3 class="admin-preview__label">דף המוצר</h3>' +
      (p.slug
        ? '<p class="admin-preview__url" dir="ltr">/store/' + escapeHtml(p.slug) + '/</p>'
        : '') +
      '<div class="admin-preview__page">' +
      productPageHtml(p) +
      '</div>';
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 50);
  }

  function loadBoard() {
    return api('GET').then(function (data) {
      products = data.products || [];
      workshops = data.workshops || [];
      original = snapshot(products);
      originalWorkshops = snapshotWorkshops(workshops);
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
    return api('POST', { action: 'save', products: products, workshops: workshops }).then(function (data) {
      original = snapshot(products);
      originalWorkshops = snapshotWorkshops(workshops);
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
    var stockInput = event.target.closest('input[data-stock]');
    if (stockInput) {
      var stockCard = stockInput.closest('[data-slug]');
      var stockProduct = products.find(function (p) {
        return p.slug === stockCard.getAttribute('data-slug');
      });
      if (!stockProduct) return;
      var raw = stockInput.value.trim();
      if (raw === '') {
        stockProduct.stock = null;
      } else {
        var n = Number(raw);
        if (!Number.isInteger(n) || n < 0) {
          stockInput.value = stockProduct.stock != null ? stockProduct.stock : '';
          return;
        }
        stockProduct.stock = n;
        if (n === 0) stockProduct.out_of_stock = true;
        else if (n > 0) stockProduct.out_of_stock = false;
      }
      render();
      return;
    }
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

  function findWorkshop(card) {
    if (!card) return null;
    var slug = card.getAttribute('data-workshop-slug');
    return workshops.find(function (w) {
      return w.slug === slug;
    });
  }

  if (workshopsEl) {
    workshopsEl.addEventListener('change', function (event) {
      var spotsInput = event.target.closest('input[data-workshop-spots]');
      if (spotsInput) {
        var workshop = findWorkshop(spotsInput.closest('[data-workshop-slug]'));
        if (!workshop) return;
        var raw = spotsInput.value.trim();
        if (raw === '') {
          workshop.spots = null;
        } else {
          var n = Number(raw);
          if (!Number.isInteger(n) || n < 0) {
            spotsInput.value = workshop.spots != null ? workshop.spots : '';
            return;
          }
          workshop.spots = n;
          if (n === 0) workshop.registration_full = true;
          else if (n > 0) workshop.registration_full = false;
        }
        render();
        return;
      }
      var flagInput = event.target.closest('input[data-workshop-flag]');
      if (!flagInput) return;
      var flagged = findWorkshop(flagInput.closest('[data-workshop-slug]'));
      if (!flagged) return;
      flagged[flagInput.getAttribute('data-workshop-flag')] = flagInput.checked;
      render();
    });
  }

  saveBtn.addEventListener('click', function () {
    saveStock().catch(function (err) {
      show(boardMessage, err.message || 'לא הצלחנו לשמור', 'error');
      saveBtn.disabled = !isDirty();
    });
  });

  newBtn.addEventListener('click', function () {
    openEditor(true, { kind: 'fixed', variants: [{}] });
  });

  kindSelect.addEventListener('change', function () {
    syncKindFields();
    schedulePreview();
  });

  document.getElementById('admin-stock').addEventListener('input', function () {
    syncEditorOutOfStock(this.value);
  });
  document.getElementById('admin-stock').addEventListener('change', function () {
    syncEditorOutOfStock(this.value);
  });

  slugInput.addEventListener('input', function () {
    if (slugInput.readOnly) return;
    slugInput.value = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  });

  addVariantBtn.addEventListener('click', function () {
    var nextIndex = variantsEl.querySelectorAll('.admin-variant').length;
    variantsEl.insertAdjacentHTML('beforeend', variantRowHtml({}, nextIndex));
    schedulePreview();
  });

  variantsEl.addEventListener('click', function (event) {
    var removePhoto = event.target.closest('[data-variant-photo-remove]');
    if (removePhoto) {
      var photoRow = removePhoto.closest('.admin-variant');
      if (photoRow) {
        var items = getVariantPhotoItems(photoRow);
        items.splice(Number(removePhoto.getAttribute('data-variant-photo-remove')), 1);
        renderVariantPhotos(photoRow);
        schedulePreview();
      }
      return;
    }
    var btn = event.target.closest('[data-remove-variant]');
    if (!btn) return;
    var row = btn.closest('.admin-variant');
    if (row) row.remove();
    if (!variantsEl.querySelector('.admin-variant')) {
      renderVariants([{}]);
    } else {
      renumberVariants();
    }
    schedulePreview();
  });

  variantsEl.addEventListener('change', function (event) {
    var fileInput = event.target.closest('[data-v-image-file]');
    if (!fileInput) return;
    var row = fileInput.closest('.admin-variant');
    var files = Array.prototype.slice.call(fileInput.files || []);
    fileInput.value = '';
    if (!row || !files.length) return;
    var items = getVariantPhotoItems(row);
    var room = MAX_VARIANT_PHOTOS - items.length;
    if (room <= 0) {
      show(editorMessage, 'אפשר עד ' + MAX_VARIANT_PHOTOS + ' תמונות לכל סוג', 'error');
      return;
    }
    files = files.slice(0, room);
    show(editorMessage, 'טוענת תמונות…', 'info');
    Promise.all(files.map(readFileAsPhoto))
      .then(function (added) {
        variantPhotos.set(row, items.concat(added));
        renderVariantPhotos(row);
        show(editorMessage, '', '');
        schedulePreview();
      })
      .catch(function (err) {
        show(editorMessage, err.message || 'לא הצלחנו להוסיף תמונה', 'error');
      });
  });

  photosEl.addEventListener('click', function (event) {
    var main = event.target.closest('[data-photo-main]');
    var up = event.target.closest('[data-photo-up]');
    var down = event.target.closest('[data-photo-down]');
    var remove = event.target.closest('[data-photo-remove]');
    if (main) {
      movePhoto(Number(main.getAttribute('data-photo-main')), 0);
      return;
    }
    if (up) {
      var fromUp = Number(up.getAttribute('data-photo-up'));
      movePhoto(fromUp, fromUp - 1);
      return;
    }
    if (down) {
      var fromDown = Number(down.getAttribute('data-photo-down'));
      movePhoto(fromDown, fromDown + 1);
      return;
    }
    if (remove) {
      photoItems.splice(Number(remove.getAttribute('data-photo-remove')), 1);
      renderPhotos();
    }
  });

  photoFiles.addEventListener('change', function () {
    var files = Array.prototype.slice.call(photoFiles.files || []);
    photoFiles.value = '';
    if (!files.length) return;
    var room = 8 - photoItems.length;
    if (room <= 0) {
      show(photosMessage || editorMessage, 'אפשר עד 8 תמונות', 'error');
      return;
    }
    files = files.slice(0, room);
    show(photosMessage || editorMessage, 'טוענת תמונות…', 'info');
    Promise.all(files.map(readFileAsPhoto))
      .then(function (items) {
        photoItems = photoItems.concat(items);
        renderPhotos();
        show(
          photosMessage || editorMessage,
          items.length === 1
            ? 'התמונה נוספה. לחצי «שמירת מוצר» כדי להעלות לאתר.'
            : 'התמונות נוספו. לחצי «שמירת מוצר» כדי להעלות לאתר.',
          'ok'
        );
      })
      .catch(function (err) {
        show(photosMessage || editorMessage, err.message || 'לא הצלחנו להוסיף תמונה', 'error');
      });
  });

  editor.addEventListener('input', function () {
    clearFieldErrors();
    if (editorMessage && !editorMessage.hidden && /admin-message--error/.test(editorMessage.className)) {
      show(editorMessage, '', '');
    }
    schedulePreview();
  });
  editor.addEventListener('change', function () {
    clearFieldErrors();
    if (editorMessage && !editorMessage.hidden && /admin-message--error/.test(editorMessage.className)) {
      show(editorMessage, '', '');
    }
    schedulePreview();
  });

  editor.addEventListener('submit', function (event) {
    event.preventDefault();
    var validationErrors = validateEditor();
    if (validationErrors.length) {
      applyValidationErrors(validationErrors);
      editorSave.disabled = false;
      return;
    }
    editorSave.disabled = true;
    clearFieldErrors();
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
        showEditorError(err.message || 'לא הצלחנו לשמור', err.field || null);
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
