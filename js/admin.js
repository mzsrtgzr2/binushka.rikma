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
  var photosEl = document.getElementById('admin-photos');
  var photoFiles = document.getElementById('admin-photo-files');
  var previewCard = document.getElementById('admin-preview-card');
  var previewPage = document.getElementById('admin-preview-page');
  if (!loginForm || !board || !editor || !photosEl) return;

  var products = [];
  var original = {};
  var editingNew = false;
  var saveHint = '';
  var photoItems = [];
  var variantUploads = new WeakMap();
  var previewTimer;

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

  function variantRowHtml(row, index) {
    row = row || {};
    var imagePath = typeof row.image === 'string' ? row.image : row.image && row.image.path ? row.image.path : '';
    var imgSrc = variantImageSrc(row.image) || imagePath;
    var n = (index == null ? 0 : index) + 1;
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
      '<p class="admin-hint">באנגלית בלבד, לשימוש פנימי בקטלוג.</p>' +
      '</div>' +
      '<div class="form__group">' +
      '<label class="form__label">תיאור</label>' +
      '<textarea class="form__input admin-body-input admin-variant__description" data-v="description" rows="12" placeholder="תיאור מלא לסוג — אפשר לכתוב כמה שורות בנוחות">' +
      escapeHtml(row.description || '') +
      '</textarea>' +
      '</div>' +
      '<div class="form__group admin-variant__image-group">' +
      '<label class="form__label">תמונה</label>' +
      '<p class="admin-hint">העלאה מהמחשב, כמו בתמונות הראשיות של המוצר.</p>' +
      '<div class="admin-variant__image">' +
      (imgSrc
        ? '<img class="admin-variant__thumb" src="' + escapeHtml(imgSrc) + '" alt="">'
        : '<span class="admin-variant__thumb admin-variant__thumb--empty" aria-hidden="true"></span>') +
      '<input type="hidden" data-v="image" value="' +
      escapeHtml(imagePath) +
      '">' +
      '<div class="admin-variant__image-actions">' +
      '<label class="button admin-upload-btn">' +
      (imgSrc ? 'החלפת תמונה' : 'העלאת תמונה') +
      '<input type="file" data-v-image-file accept="image/jpeg,image/png,image/webp,image/gif">' +
      '</label>' +
      (imgSrc
        ? '<button type="button" class="admin-variant__clear-image" data-clear-variant-image>הסרת תמונה</button>'
        : '') +
      '</div></div></div></div>'
    );
  }

  function renderVariants(rows) {
    var list = rows && rows.length ? rows : [{}];
    variantsEl.innerHTML = list
      .map(function (row, index) {
        return variantRowHtml(row, index);
      })
      .join('');
  }

  function renumberVariants() {
    Array.prototype.forEach.call(variantsEl.querySelectorAll('.admin-variant'), function (row, index) {
      var label = row.querySelector('.admin-variant__label');
      if (label) label.textContent = 'סוג ' + (index + 1);
    });
  }

  function readVariantImage(row) {
    var upload = variantUploads.get(row);
    if (upload) return { upload: upload };
    var pathValue = ((row.querySelector('[data-v="image"]') || {}).value || '').trim();
    return pathValue;
  }

  function readVariants() {
    return Array.prototype.map.call(variantsEl.querySelectorAll('.admin-variant'), function (row) {
      return {
        id: (row.querySelector('[data-v="id"]') || {}).value,
        name: (row.querySelector('[data-v="name"]') || {}).value,
        price: (row.querySelector('[data-v="price"]') || {}).value,
        image: readVariantImage(row),
        description: (row.querySelector('[data-v="description"]') || {}).value,
      };
    });
  }

  function setVariantImagePreview(row, src, pathValue) {
    var box = row.querySelector('.admin-variant__image');
    if (!box) return;
    var thumb = box.querySelector('.admin-variant__thumb');
    if (src) {
      if (!thumb || thumb.tagName !== 'IMG') {
        var img = document.createElement('img');
        img.className = 'admin-variant__thumb';
        img.alt = '';
        if (thumb) box.replaceChild(img, thumb);
        else box.insertBefore(img, box.firstChild);
        thumb = img;
      }
      thumb.src = src;
    } else if (thumb) {
      var empty = document.createElement('span');
      empty.className = 'admin-variant__thumb admin-variant__thumb--empty';
      empty.setAttribute('aria-hidden', 'true');
      box.replaceChild(empty, thumb);
    }
    var pathInput = box.querySelector('[data-v="image"]');
    if (pathInput) pathInput.value = pathValue || '';
    var actions = box.querySelector('.admin-variant__image-actions');
    if (actions) {
      var label = actions.querySelector('.admin-upload-btn');
      if (label) {
        var fileInput = label.querySelector('input[type="file"]');
        label.textContent = src ? 'החלפת תמונה' : 'העלאת תמונה';
        if (fileInput) label.appendChild(fileInput);
      }
      var clearBtn = actions.querySelector('[data-clear-variant-image]');
      if (src && !clearBtn) {
        clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'admin-variant__clear-image';
        clearBtn.setAttribute('data-clear-variant-image', '');
        clearBtn.textContent = 'הסרת תמונה';
        actions.appendChild(clearBtn);
      } else if (!src && clearBtn) {
        clearBtn.remove();
      }
    }
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
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          var mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          var compressed = canvas.toDataURL(mime, 0.82);
          var filename = String(file.name || 'photo').replace(/\.[^.]+$/, mime === 'image/png' ? '.png' : '.jpg');
          finish(compressed, mime, filename);
        };
        img.onerror = function () {
          finish(dataUrl, file.type, file.name);
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
    document.getElementById('admin-cart-price').value = product.cart_price > 0 ? product.cart_price : '';
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
    updatePreview();
  }

  function readEditor() {
    return {
      slug: slugInput.value.trim().toLowerCase(),
      title: document.getElementById('admin-title').value,
      subtitle: document.getElementById('admin-subtitle').value,
      photos: photoItems.map(function (item) {
        if (item.upload) return { upload: item.upload };
        return { path: item.path };
      }),
      kind: kindSelect.value,
      cart_price: document.getElementById('admin-cart-price').value,
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
    if (p.out_of_stock) return '<div class="out-of-stock">אזל מהמלאי</div>';
    if (p.limited_stock) return '<div class="limited-stock">מלאי מוגבל</div>';
    return '';
  }

  function stockText(p) {
    if (p.out_of_stock) return '<div class="out-of-stock-text">אזל מהמלאי</div>';
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
    if (p.out_of_stock || p.kind === 'content') return '';
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
        var imgSrc = variantImageSrc(v.image);
        var img = imgSrc
          ? scrunchie
            ? '<div class="scrunchies-variant__photo"><img src="' +
              escapeHtml(imgSrc) +
              '" alt=""></div>'
            : '<img class="store-variant__photo" src="' + escapeHtml(imgSrc) + '" alt="">'
          : '';
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
    if (p.out_of_stock || p.kind === 'content') return '';
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

  kindSelect.addEventListener('change', function () {
    syncKindFields();
    schedulePreview();
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
    var clearBtn = event.target.closest('[data-clear-variant-image]');
    if (clearBtn) {
      var clearRow = clearBtn.closest('.admin-variant');
      if (clearRow) {
        variantUploads.delete(clearRow);
        setVariantImagePreview(clearRow, '', '');
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
    var file = (fileInput.files || [])[0];
    fileInput.value = '';
    if (!row || !file) return;
    show(editorMessage, 'טוענת תמונה…', 'info');
    readFileAsPhoto(file)
      .then(function (item) {
        variantUploads.set(row, item.upload);
        setVariantImagePreview(row, item.preview, '');
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
      show(editorMessage, 'אפשר עד 8 תמונות', 'error');
      return;
    }
    files = files.slice(0, room);
    show(editorMessage, 'טוענת תמונות…', 'info');
    Promise.all(files.map(readFileAsPhoto))
      .then(function (items) {
        photoItems = photoItems.concat(items);
        renderPhotos();
        show(editorMessage, '', '');
      })
      .catch(function (err) {
        show(editorMessage, err.message || 'לא הצלחנו להוסיף תמונה', 'error');
      });
  });

  editor.addEventListener('input', schedulePreview);
  editor.addEventListener('change', schedulePreview);

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
