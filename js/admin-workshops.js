/**
 * Workshop backoffice: login, list workshops, write one in Markdown, price it.
 *
 * Login posts to /api/admin/ because that handler owns the session cookie; the
 * workshop endpoint only verifies it. One password, every screen.
 */
(function () {
  var loginForm = document.getElementById('admin-login');
  var loginMessage = document.getElementById('admin-login-message');
  var board = document.getElementById('admin-board');
  var boardMessage = document.getElementById('admin-board-message');
  var listView = document.getElementById('admin-list-view');
  var listEl = document.getElementById('admin-list');
  var statsEl = document.getElementById('admin-stats');
  var newBtn = document.getElementById('admin-new');
  var saveSpotsBtn = document.getElementById('admin-save');
  var logoutBtn = document.getElementById('admin-logout');
  var editor = document.getElementById('admin-editor');
  var editorTitle = document.getElementById('admin-editor-title');
  var editorMessage = document.getElementById('admin-editor-message');
  var editorCancel = document.getElementById('admin-editor-cancel');
  var editorDelete = document.getElementById('admin-editor-delete');
  var saveBtn = document.getElementById('workshop-save');
  var slugInput = document.getElementById('workshop-slug');
  var slugHint = document.getElementById('workshop-slug-hint');
  var titleInput = document.getElementById('workshop-title');
  var subtitleInput = document.getElementById('workshop-subtitle');
  var dateInput = document.getElementById('workshop-date');
  var imageInput = document.getElementById('workshop-image');
  var imagePick = document.getElementById('workshop-image-pick');
  var imageFile = document.getElementById('workshop-image-file');
  var bodyInput = document.getElementById('workshop-body');
  var bodyImagePick = document.getElementById('workshop-body-image-pick');
  var bodyImageFile = document.getElementById('workshop-body-image-file');
  var linkPick = document.getElementById('workshop-link-pick');
  var linkBox = document.getElementById('workshop-linkbox');
  var linkTextInput = document.getElementById('workshop-link-text');
  var linkUrlInput = document.getElementById('workshop-link-url');
  var linkResults = document.getElementById('workshop-link-results');
  var linkInsert = document.getElementById('workshop-link-insert');
  var linkCancel = document.getElementById('workshop-link-cancel');
  var pricePerSelect = document.getElementById('workshop-price-per');
  var priceInput = document.getElementById('workshop-price');
  var spotsInput = document.getElementById('workshop-spots');
  var spotsGroup = document.getElementById('workshop-spots-group');
  var formUrlInput = document.getElementById('workshop-form-url');
  var packsGroup = document.getElementById('workshop-packs-group');
  var packsEl = document.getElementById('workshop-packs');
  var addPackBtn = document.getElementById('workshop-add-pack');
  var fullInput = document.getElementById('workshop-registration-full');
  var lastPlacesInput = document.getElementById('workshop-last-places');
  var notOpenInput = document.getElementById('workshop-registration-not-open');
  var hideInput = document.getElementById('workshop-hide');
  var previewCard = document.getElementById('workshop-preview-card');
  var previewPage = document.getElementById('workshop-preview-page');
  var historyEl = document.getElementById('workshop-history');
  var undoBtn = document.getElementById('workshop-undo');
  var redoBtn = document.getElementById('workshop-redo');
  if (!loginForm || !board || !editor || !packsEl) return;

  var MAX_PACKS = 6;

  var workshops = [];
  var original = {};
  var current = null;
  var previewTimer;
  var saveHint = '';

  /* Committed path -> the data URL the browser already has. An image is only
     served from /images/... after the next site build, so until then the
     preview would show a broken image of something just uploaded. */
  var localPreviews = {};

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
      no_write_target: 'חסרה הגדרת GITHUB_TOKEN — אי אפשר לשמור סדנאות',
      not_found: 'הסדנה לא נמצאה',
      slug_taken: 'כבר יש סדנה עם המזהה הזה',
      slug_invalid: 'מזהה לא תקין (באנגלית, אותיות קטנות ומקפים)',
      title_required: 'צריך שם לסדנה',
      date_required: 'צריך תאריך ושעה',
      price_invalid: 'מחיר לא תקין',
      spots_invalid: 'מספר מקומות לא תקין (0–99999)',
      image_invalid: 'נתיב התמונה חייב להתחיל ב-/images/',
      form_url_invalid: 'קישור ההרשמה חייב להתחיל ב-http',
      pack_name_required: 'לכל חבילה צריך שם',
      pack_price_invalid: 'מחיר החבילה חייב להיות מספר שלם גדול מ-0',
      pack_places_invalid: 'מספר המקומות בחבילה חייב להיות 1 או יותר',
      packs_need_per_participant: 'חבילות אפשריות רק כשגובים מחיר למשתתפת',
      too_many_packs: 'אפשר עד ' + MAX_PACKS + ' חבילות',
      invalid_request: 'הבקשה לא תקינה'
    };
    return messages[code] || '';
  }

  function request(url, method, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
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
          error.field = data.field || null;
          throw error;
        }
        return data;
      });
    });
  }

  function api(method, body) {
    return request('/api/admin-workshops', method, body);
  }

  /* ------------------------------------------------------------------ images

     Shrunk in the browser before upload: the request travels as base64 inside
     a JSON body, and the file ends up committed to the repository, so sending
     a 6MB phone photo through untouched helps nobody. */
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.type)) {
        reject(new Error('רק jpg, png, webp או gif'));
        return;
      }

      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('לא הצלחנו לקרוא את הקובץ')); };
      reader.onload = function () {
        var dataUrl = String(reader.result || '');

        function finish(data, mime, filename) {
          if (data.length > 3400000) {
            reject(new Error('תמונה גדולה מדי (עד 2.5MB אחרי דחיסה)'));
            return;
          }
          resolve({ filename: filename, mime: mime, data: data });
        }

        // Animated GIFs and already-small files go as they are; re-encoding a
        // GIF through a canvas would keep only its first frame.
        if (file.type === 'image/gif' || file.size < 900000) {
          finish(dataUrl, file.type, file.name);
          return;
        }

        var img = new Image();
        img.onerror = function () { reject(new Error('לא הצלחנו לעבד את התמונה')); };
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
          // Transparent PNGs would otherwise go black once flattened to JPEG.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          var qualities = [0.82, 0.7, 0.55, 0.4];
          var compressed = '';
          for (var i = 0; i < qualities.length; i++) {
            compressed = canvas.toDataURL('image/jpeg', qualities[i]);
            if (compressed.length <= 3400000) break;
          }

          finish(compressed, 'image/jpeg', String(file.name || 'image').replace(/\.[^.]+$/, '.jpg'));
        };
        img.src = dataUrl;
      };

      reader.readAsDataURL(file);
    });
  }

  function uploadImage(file) {
    return readImage(file).then(function (payload) {
      return api('POST', { action: 'upload', file: payload }).then(function (data) {
        localPreviews[data.url] = payload.data;
        return data.url;
      });
    });
  }

  function previewSrc(url) {
    return localPreviews[url] || url;
  }

  function handlePicked(input, onUploaded) {
    var file = input.files && input.files[0];
    if (!file) return;

    show(editorMessage, 'מעלה תמונה...', 'info');

    uploadImage(file)
      .then(function (url) {
        onUploaded(url);
        updatePreview();
        show(editorMessage, 'התמונה הועלתה.', 'ok');
      })
      .catch(function (error) {
        show(editorMessage, error.message, 'error');
      })
      .then(function () {
        // Cleared so picking the same file again still fires a change event.
        input.value = '';
      });
  }

  /** Drops text where the caret is rather than at the end of the page. */
  function insertAtCaret(textarea, snippet) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;

    if (typeof start !== 'number') {
      textarea.value += snippet;
    } else {
      textarea.value = textarea.value.slice(0, start) + snippet + textarea.value.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + snippet.length;
    }

    textarea.focus();
  }

  /* ------------------------------------------------------------------- links

     Suggestions come from a JSON block the site build writes into this page,
     so they are whatever is actually published. Something added since the last
     deploy will not be listed yet; pasting its address still works. */
  var linkIndex = (function () {
    var el = document.getElementById('admin-link-index');
    if (!el) return [];

    try {
      return JSON.parse(el.textContent) || [];
    } catch (error) {
      return [];
    }
  })();

  var linkMatches = [];
  var linkActive = -1;

  function searchLinks(query) {
    var needle = String(query || '').trim().toLowerCase();
    if (!needle) return linkIndex.slice(0, 8);

    var starts = [];
    var contains = [];

    linkIndex.forEach(function (entry) {
      var title = String(entry.title || '').toLowerCase();
      var url = String(entry.url || '').toLowerCase();
      var at = title.indexOf(needle);

      if (at === 0) starts.push(entry);
      else if (at > 0 || url.indexOf(needle) >= 0) contains.push(entry);
    });

    return starts.concat(contains).slice(0, 8);
  }

  function renderLinkResults() {
    if (!linkMatches.length) {
      linkResults.hidden = true;
      linkResults.innerHTML = '';
      return;
    }

    linkResults.innerHTML = linkMatches.map(function (entry, index) {
      return (
        '<li><button type="button" class="admin-linkbox__result' +
        (index === linkActive ? ' is-active' : '') +
        '" data-link-index="' + index + '">' +
        '<span class="admin-linkbox__result-title">' + escapeHtml(entry.title) + '</span>' +
        '<span class="admin-linkbox__result-kind">' + escapeHtml(entry.kind) + '</span>' +
        '<span class="admin-linkbox__result-url" dir="ltr">' + escapeHtml(entry.url) + '</span>' +
        '</button></li>'
      );
    }).join('');

    linkResults.hidden = false;
  }

  function chooseLink(entry) {
    linkUrlInput.value = entry.url;
    if (!linkTextInput.value.trim()) linkTextInput.value = entry.title;

    linkMatches = [];
    linkActive = -1;
    renderLinkResults();
    linkTextInput.focus();
  }

  function openLinkBox() {
    var selected = bodyInput.value.slice(bodyInput.selectionStart, bodyInput.selectionEnd).trim();

    linkTextInput.value = selected;
    linkUrlInput.value = '';
    linkMatches = searchLinks('');
    linkActive = -1;
    renderLinkResults();

    linkBox.hidden = false;
    (selected ? linkUrlInput : linkTextInput).focus();
  }

  function closeLinkBox() {
    linkBox.hidden = true;
    linkMatches = [];
    linkActive = -1;
    renderLinkResults();
    bodyInput.focus();
  }

  function insertLink() {
    var url = linkUrlInput.value.trim();
    if (!url) {
      show(editorMessage, 'צריך לבחור עמוד או להדביק כתובת', 'error');
      return;
    }

    var text = linkTextInput.value.trim() || url;

    // insertAtCaret writes over the selection, so a link built around selected
    // words replaces them rather than writing them out twice.
    insertAtCaret(bodyInput, '[' + text + '](' + url + ')');

    closeLinkBox();
    updatePreview();
    record('הוספת קישור', '');
  }

  /* ---------------------------------------------------------------- markdown

     Covers the subset documented under the editor. The page itself is rendered
     by kramdown at build time, so this is a preview, not the source of truth. */
  function renderMarkdown(source) {
    var lines = String(source || '').split(/\r?\n/);
    var html = '';
    var paragraph = [];
    var listItems = [];

    function inline(text) {
      return escapeHtml(text)
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (match, alt, url) {
          return '<img src="' + escapeHtml(previewSrc(url)) + '" alt="' + alt + '">';
        })
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    }

    function flushParagraph() {
      if (!paragraph.length) return;
      // Kramdown turns two trailing spaces into a line break, and the workshop
      // pages use that for their location / date / price block.
      html += '<p>' + paragraph.map(inline).join('<br>') + '</p>';
      paragraph = [];
    }

    function flushList() {
      if (!listItems.length) return;
      html += '<ul>' + listItems.map(function (item) {
        return '<li>' + inline(item) + '</li>';
      }).join('') + '</ul>';
      listItems = [];
    }

    lines.forEach(function (line) {
      var heading = /^(#{1,4})\s+(.*)$/.exec(line);
      var bullet = /^\s*[-*]\s+(.*)$/.exec(line);

      if (heading) {
        flushParagraph();
        flushList();
        var level = heading[1].length;
        html += '<h' + level + '>' + inline(heading[2]) + '</h' + level + '>';
        return;
      }

      if (bullet) {
        flushParagraph();
        listItems.push(bullet[1]);
        return;
      }

      if (!line.trim()) {
        flushParagraph();
        flushList();
        return;
      }

      flushList();
      paragraph.push(line.trim());
    });

    flushParagraph();
    flushList();
    return html;
  }

  /* -------------------------------------------------------------------- date */

  function dateParts(value) {
    var match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(String(value || '').trim());
    if (!match) return null;
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4] || 0),
      minute: Number(match[5] || 0)
    };
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  /** What the datetime-local field shows, from whatever the page stores. */
  function toLocalInput(value) {
    var parts = dateParts(value);
    if (!parts) return '';
    return parts.year + '-' + pad(parts.month) + '-' + pad(parts.day) + 'T' + pad(parts.hour) + ':' + pad(parts.minute);
  }

  function formatDate(value) {
    var parts = dateParts(value);
    if (!parts) return '';

    var date = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    try {
      return new Intl.DateTimeFormat('he-IL', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(date);
    } catch (e) {
      return date.toLocaleString();
    }
  }

  /* ------------------------------------------------------------------- packs */

  /* A pack's id is the variant a cart holds, so an existing one is carried
     through the form rather than derived again from its name — renaming the
     pack, or just saving an unrelated field, must not strand a full cart. */
  function packRowHtml(pack, index) {
    pack = pack || {};
    return (
      '<div class="admin-pack" data-pack-id="' + escapeHtml(pack.id || '') + '">' +
      '<div class="admin-pack__heading">' +
      '<p class="admin-pack__label">חבילה ' + (index + 1) + '</p>' +
      '<button type="button" class="admin-pack__remove" data-remove-pack>הסרה</button>' +
      '</div>' +
      '<div class="admin-pack__fields">' +
      '<label class="admin-pack__field"><span>שם</span>' +
      '<input class="form__input" data-pack="name" placeholder="למשל: שתי משתתפות ביחד" value="' +
      escapeHtml(pack.name || '') + '"></label>' +
      '<label class="admin-pack__field"><span>מחיר (₪)</span>' +
      '<input class="form__input" data-pack="price" type="number" min="1" step="1" dir="ltr" value="' +
      escapeHtml(pack.price || '') + '"></label>' +
      '<label class="admin-pack__field"><span>מקומות</span>' +
      '<input class="form__input" data-pack="places" type="number" min="1" step="1" dir="ltr" value="' +
      escapeHtml(pack.places == null ? 1 : pack.places) + '"></label>' +
      '</div></div>'
    );
  }

  function renderPacks(packs) {
    packsEl.innerHTML = (packs || []).map(packRowHtml).join('');
  }

  function renumberPacks() {
    Array.prototype.forEach.call(packsEl.querySelectorAll('.admin-pack__label'), function (label, index) {
      label.textContent = 'חבילה ' + (index + 1);
    });
  }

  /** Every row as it stands, blank ones included, so history can restore one. */
  function packRows() {
    return Array.prototype.map.call(packsEl.querySelectorAll('.admin-pack'), function (row) {
      return {
        id: row.getAttribute('data-pack-id') || '',
        name: (row.querySelector('[data-pack="name"]') || {}).value || '',
        price: (row.querySelector('[data-pack="price"]') || {}).value || '',
        places: (row.querySelector('[data-pack="places"]') || {}).value || ''
      };
    });
  }

  function readPacks() {
    return packRows().filter(function (pack) {
      return String(pack.name).trim() || String(pack.price).trim();
    });
  }

  /* ----------------------------------------------------------------- preview */

  function packPrices(packs) {
    return (packs || [])
      .map(function (pack) { return Number(pack.price); })
      .filter(function (n) { return n > 0; });
  }

  /** What the cart would charge: the cheapest pack, or the plain price. */
  function effectivePrice(workshop) {
    var prices = packPrices(workshop.packs);
    if (prices.length) return Math.min.apply(null, prices);
    return Number(workshop.cart_price) > 0 ? Number(workshop.cart_price) : 0;
  }

  function priceUnit(workshop) {
    return workshop.price_per === 'workshop' ? 'לסדנה' : 'למשתתפת';
  }

  function spotsOf(workshop) {
    var raw = workshop.spots;
    if (raw == null || raw === '') return null;
    var n = Number(raw);
    return Number.isInteger(n) ? n : null;
  }

  function isSoldOut(workshop) {
    return Boolean(workshop.registration_full) || spotsOf(workshop) === 0;
  }

  function isLastPlaces(workshop) {
    if (workshop.last_places) return true;
    if (workshop.price_per === 'workshop') return false;
    var spots = spotsOf(workshop);
    return spots != null && spots > 0 && spots <= 3;
  }

  function statusLabel(workshop) {
    if (workshop.hide) return 'מוסתרת';
    if (workshop.registration_not_open) return 'לפני פתיחת הרשמה';
    if (isSoldOut(workshop)) return 'מלאה';
    var spots = spotsOf(workshop);
    if (spots != null) return 'מקומות: ' + spots;
    return 'פתוחה';
  }

  function badgeText(workshop) {
    if (workshop.registration_not_open) return 'ההרשמה תיפתח בקרוב';
    if (isSoldOut(workshop)) return 'אין מקומות פנויים';
    if (isLastPlaces(workshop)) return 'מקומות אחרונים';
    return '';
  }

  function fakeButton(label, extraClass) {
    return (
      '<button type="button" class="button button--primary' + (extraClass ? ' ' + extraClass : '') +
      '" tabindex="-1" aria-hidden="true">' + escapeHtml(label) + '</button>'
    );
  }

  function cardHtml(workshop) {
    var image = workshop.image ? previewSrc(workshop.image) : '';
    var badge = badgeText(workshop);
    var price = effectivePrice(workshop);
    var soldOut = isSoldOut(workshop);

    var footer = '';
    if (price > 0 && !workshop.registration_not_open) {
      footer = soldOut
        ? '<span class="project__sold-out">אין מקומות פנויים</span>'
        : fakeButton(
            workshop.price_per === 'workshop' ? 'הזמנת סדנה' : 'הרשמה לסדנה',
            'project__add'
          );
    }

    return (
      '<article class="project' + (workshop.hide ? ' is-preview-hidden' : '') + '">' +
      '<div class="project__content">' +
      '<span class="project__image">' +
      (image ? '<img src="' + escapeHtml(image) + '" alt="">' : '') +
      (badge ? '<div class="registration-full">' + escapeHtml(badge) + '</div>' : '') +
      '</span>' +
      '<div class="project__info">' +
      '<h3 class="project__title"><span>' + escapeHtml(workshop.title || 'שם הסדנה') + '</span></h3>' +
      (workshop.subtitle ? '<div class="project__subtitle">' + escapeHtml(workshop.subtitle) + '</div>' : '') +
      (footer ? '<div class="project__footer">' + footer + '</div>' : '') +
      '</div></div></article>'
    );
  }

  function bookingHtml(workshop) {
    var price = effectivePrice(workshop);
    if (!(price > 0)) {
      if (!workshop.form_url) return '';
      return '<div class="section__navigation">' + fakeButton('הרשמי לסדנה זו', 'section-button') + '</div>';
    }

    var packs = (workshop.packs || []).filter(function (pack) { return Number(pack.price) > 0; });
    var spots = spotsOf(workshop);
    var showSpots = spots != null && workshop.price_per !== 'workshop';

    var body = '';
    if (!packs.length) {
      body +=
        '<div class="workshop-booking__head">' +
        '<span class="workshop-booking__price">₪' + escapeHtml(price) + '</span>' +
        '<span class="workshop-booking__per">' + priceUnit(workshop) + '</span>' +
        '</div>';
    }

    if (showSpots) {
      body +=
        '<p class="workshop-booking__spots">' +
        (spots <= 3 ? 'מקומות אחרונים — נותרו ' + spots : 'נותרו ' + spots + ' מקומות') +
        '</p>';
    }

    if (packs.length) {
      body += '<div class="workshop-booking__packs">' + packs.map(function (pack) {
        var places = Number(pack.places) || 1;
        var saved = places > 1 ? price * places - Number(pack.price) : 0;
        return (
          '<button type="button" class="button button--primary workshop-booking__pack" tabindex="-1" aria-hidden="true">' +
          '<span class="workshop-booking__pack-name">' + escapeHtml(pack.name || 'חבילה') + '</span>' +
          '<span class="workshop-booking__pack-price">₪' + escapeHtml(pack.price) + '</span>' +
          (saved > 0 ? '<span class="workshop-booking__pack-save">חוסכות ₪' + escapeHtml(saved) + '</span>' : '') +
          '</button>'
        );
      }).join('') + '</div>';
    } else {
      body += fakeButton(
        workshop.price_per === 'workshop' ? 'הזמיני סדנה זו' : 'הרשמי לסדנה זו',
        'section-button'
      );
    }

    body +=
      '<p class="workshop-booking__note">ההרשמה עוברת לסל הקניות — אפשר להוסיף עוד משתתפות, סדנאות או מוצרים מהחנות ולשלם הכל בתשלום מאובטח אחד.</p>';

    return '<div class="workshop-booking">' + body + '</div>';
  }

  function pageHtml(workshop) {
    var badge = badgeText(workshop);
    var price = effectivePrice(workshop);
    var image = workshop.image ? previewSrc(workshop.image) : '';
    var priceLine = '';
    if (price > 0) {
      priceLine =
        '<div class="project-price">' +
        ((workshop.packs || []).length ? 'מ־' : '') + '₪' + escapeHtml(price) + ' ' + priceUnit(workshop) +
        '</div>';
    }

    var content = workshop.registration_not_open
      ? '<p>פרטי הסדנה יפורסמו בקרוב.</p>'
      : renderMarkdown(workshop.body);

    return (
      '<div class="page-head">' +
      '<h1 class="page-title">' + escapeHtml(workshop.title || 'שם הסדנה') + '</h1>' +
      (badge ? '<div class="registration-full-text">' + escapeHtml(badge) + '</div>' : '') +
      (workshop.subtitle ? '<p class="project-subtitle">' + escapeHtml(workshop.subtitle) + '</p>' : '') +
      priceLine +
      '</div>' +
      '<div class="admin-preview__markdown">' + content + '</div>' +
      (isSoldOut(workshop) || workshop.registration_not_open ? '' : bookingHtml(workshop)) +
      (image
        ? '<div class="page-image"><div class="project-image-container">' +
          '<img src="' + escapeHtml(image) + '" alt="">' +
          (badge ? '<div class="registration-full">' + escapeHtml(badge) + '</div>' : '') +
          '</div></div>'
        : '')
    );
  }

  function updatePreview() {
    if (!previewCard || !previewPage || editor.hidden) return;

    var workshop = readEditor();
    var hiddenNote = workshop.hide
      ? '<p class="admin-preview__hidden">מוסתרת — הסדנה לא תופיע ברשימה ולא תהיה בסל</p>'
      : '';

    // A page's address does not always follow its slug, so an existing one is
    // read off the page rather than guessed from the name in the form.
    var url = (current && current.permalink) || (workshop.slug ? '/projects/' + workshop.slug + '/' : '');

    previewCard.innerHTML = '<h3 class="admin-preview__label">ברשימת הסדנאות</h3>' + hiddenNote + cardHtml(workshop);
    previewPage.innerHTML =
      '<h3 class="admin-preview__label">עמוד הסדנה</h3>' +
      (url ? '<p class="admin-preview__url" dir="ltr">' + escapeHtml(url) + '</p>' : '') +
      '<div class="admin-preview__page">' + pageHtml(workshop) + '</div>';
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 120);
  }

  /* -------------------------------------------------------------------- list */

  function snapshot(list) {
    var map = {};
    (list || []).forEach(function (workshop) {
      map[workshop.slug] = {
        spots: workshop.spots == null ? null : Number(workshop.spots),
        registration_full: Boolean(workshop.registration_full),
        hide: Boolean(workshop.hide)
      };
    });
    return map;
  }

  function isDirty() {
    return workshops.some(function (workshop) {
      var before = original[workshop.slug] || {};
      var spots = workshop.spots == null ? null : Number(workshop.spots);
      return (
        spots !== (before.spots == null ? null : Number(before.spots)) ||
        Boolean(workshop.registration_full) !== Boolean(before.registration_full) ||
        Boolean(workshop.hide) !== Boolean(before.hide)
      );
    });
  }

  function cardMeta(workshop) {
    var parts = [];
    var when = formatDate(workshop.date);
    if (when) parts.push(when);
    if (workshop.subtitle) parts.push(workshop.subtitle);

    var price = effectivePrice(workshop);
    if (price > 0) parts.push(((workshop.packs || []).length ? 'מ־' : '') + '₪' + price + ' ' + priceUnit(workshop));
    else parts.push('בלי הרשמה בסל');

    return parts.join(' · ');
  }

  function render() {
    listEl.innerHTML = workshops.map(function (workshop) {
      return (
        '<li class="admin-card" data-slug="' + escapeHtml(workshop.slug) + '">' +
        (workshop.image
          ? '<img class="admin-card__thumb" src="' + escapeHtml(previewSrc(workshop.image)) + '" alt="">'
          : '<span class="admin-card__thumb admin-card__thumb--empty"></span>') +
        '<div class="admin-card__body">' +
        '<div class="admin-card__head">' +
        '<strong>' + escapeHtml(workshop.title) + '</strong>' +
        '<span class="admin-card__badge">' + escapeHtml(statusLabel(workshop)) + '</span>' +
        '</div>' +
        '<p class="admin-card__meta">' + escapeHtml(cardMeta(workshop)) + '</p>' +
        '<label class="admin-stock">מקומות פנויים' +
        '<input type="number" class="admin-stock__input" data-spots min="0" step="1" dir="ltr" placeholder="—"' +
        (workshop.spots == null ? '' : ' value="' + escapeHtml(workshop.spots) + '"') +
        '></label>' +
        '<label class="admin-check"><input type="checkbox" data-flag="registration_full"' +
        (workshop.registration_full ? ' checked' : '') + '> ההרשמה מלאה</label>' +
        '<label class="admin-check"><input type="checkbox" data-flag="hide"' +
        (workshop.hide ? ' checked' : '') + '> הסתר מהאתר</label>' +
        '<button type="button" class="admin-card__edit" data-edit="' + escapeHtml(workshop.slug) + '">עריכה</button>' +
        '</div></li>'
      );
    }).join('');

    if (!workshops.length) {
      listEl.innerHTML = '<li class="admin-hint">עוד אין סדנאות. אפשר להתחיל מ«סדנה חדשה».</li>';
    }

    saveSpotsBtn.disabled = !isDirty();
  }

  function renderStats() {
    if (!statsEl) return;

    var open = workshops.filter(function (workshop) {
      return !workshop.hide && !isSoldOut(workshop) && !workshop.registration_not_open;
    }).length;

    statsEl.textContent = workshops.length
      ? workshops.length + ' סדנאות · ' + open + ' פתוחות להרשמה'
      : '';
  }

  function findWorkshop(slug) {
    return workshops.filter(function (workshop) { return workshop.slug === slug; })[0] || null;
  }

  function savedMessage(data, lead) {
    return (lead ? lead + ' ' : '') + (data && data.target === 'local'
      ? 'האתר יתעדכן אחרי שהוא ייבנה מחדש.'
      : 'האתר יתעדכן אחרי הבילד ב-Vercel (בדרך כלל עד דקה-שתיים).');
  }

  function saveSpots() {
    saveSpotsBtn.disabled = true;
    show(boardMessage, 'שומרת…', 'info');

    var payload = workshops.map(function (workshop) {
      return {
        slug: workshop.slug,
        spots: workshop.spots,
        registration_full: workshop.registration_full,
        hide: workshop.hide
      };
    });

    return api('POST', { action: 'stock', workshops: payload }).then(function (data) {
      original = snapshot(workshops);
      render();
      var changed = (data.changed || []).length;
      show(boardMessage, changed ? savedMessage(data, 'נשמר.') : 'אין שינויים לשמור', changed ? 'ok' : 'info');
      return data;
    });
  }

  /* ------------------------------------------------------------------ editor */

  function blankWorkshop() {
    var now = new Date();
    now.setMinutes(0, 0, 0);
    return {
      slug: '',
      title: '',
      subtitle: '',
      date: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':00',
      image: '',
      body: '',
      cart_price: 0,
      price_per: 'participant',
      spots: null,
      form_url: '',
      packs: [],
      registration_full: false,
      registration_not_open: false,
      last_places: false,
      hide: false
    };
  }

  function syncPricePer() {
    var perWorkshop = pricePerSelect.value === 'workshop';
    // A price for the whole session has no places to count and nothing to
    // split into packs, so both stop applying.
    spotsGroup.hidden = perWorkshop;
    packsGroup.hidden = perWorkshop;
  }

  function fillEditor(workshop, historyLabel) {
    current = workshop && workshop.slug ? workshop : null;
    var data = workshop || blankWorkshop();

    editorTitle.textContent = current ? 'עריכת ' + (data.title || data.slug) : 'סדנה חדשה';
    slugInput.value = data.slug || '';
    slugInput.readOnly = Boolean(current);
    slugHint.textContent = current
      ? 'הכתובת של סדנה שכבר קיימת לא משתנה — קישורים שנשלחו כבר מצביעים עליה.'
      : 'באנגלית, אותיות קטנות ומקפים. ריק = ייגזר משם הסדנה.';

    titleInput.value = data.title || '';
    subtitleInput.value = data.subtitle || '';
    dateInput.value = toLocalInput(data.date);
    imageInput.value = data.image || '';
    bodyInput.value = data.body || '';
    pricePerSelect.value = data.price_per === 'workshop' ? 'workshop' : 'participant';
    priceInput.value = Number(data.cart_price) > 0 ? data.cart_price : '';
    spotsInput.value = data.spots == null ? '' : data.spots;
    formUrlInput.value = data.form_url || '';
    fullInput.checked = Boolean(data.registration_full);
    lastPlacesInput.checked = Boolean(data.last_places);
    notOpenInput.checked = Boolean(data.registration_not_open);
    hideInput.checked = Boolean(data.hide);
    renderPacks(data.packs || []);

    linkBox.hidden = true;
    editorDelete.hidden = !current;
    syncPricePer();
    show(editorMessage, '');

    // A save is a floor, not a step: undoing past it would suggest it could be
    // taken back, and the page is already committed by then.
    resetHistory(historyLabel || (current ? 'הסדנה נפתחה' : 'סדנה חדשה'));
  }

  function readEditor() {
    var perWorkshop = pricePerSelect.value === 'workshop';
    var spotsRaw = String(spotsInput.value || '').trim();

    return {
      slug: slugInput.value.trim().toLowerCase(),
      title: titleInput.value.trim(),
      subtitle: subtitleInput.value.trim(),
      date: dateInput.value,
      image: imageInput.value.trim(),
      body: bodyInput.value,
      cart_price: priceInput.value,
      price_per: perWorkshop ? 'workshop' : 'participant',
      spots: perWorkshop || spotsRaw === '' ? null : Number(spotsRaw),
      form_url: formUrlInput.value.trim(),
      packs: perWorkshop ? [] : readPacks(),
      registration_full: fullInput.checked,
      registration_not_open: notOpenInput.checked,
      last_places: lastPlacesInput.checked,
      hide: hideInput.checked
    };
  }

  /* ----------------------------------------------------------------- history

     Every change to the form becomes a version, and Ctrl+Z walks back through
     them. The browser's own undo is deliberately displaced: it only knows
     about one field at a time and nothing about uploading an image or
     removing a pack, so leaving it in place would mean two undo stacks that
     disagree about what the last change was. */

  var VERSION_LIMIT = 100;

  /* A burst of typing in one field is one version. Recording a version per
     keystroke would bury the steps worth returning to under a step per
     letter. */
  var TYPING_GROUP_MS = 700;

  var FIELD_LABELS = {
    'workshop-title': 'שם הסדנה',
    'workshop-subtitle': 'תת כותרת',
    'workshop-date': 'תאריך ושעה',
    'workshop-slug': 'מזהה',
    'workshop-image': 'תמונה ראשית',
    'workshop-body': 'תוכן העמוד',
    'workshop-price-per': 'אופן הגבייה',
    'workshop-price': 'מחיר',
    'workshop-spots': 'מקומות פנויים',
    'workshop-form-url': 'קישור הרשמה',
    'workshop-registration-full': 'ההרשמה מלאה',
    'workshop-last-places': 'מקומות אחרונים',
    'workshop-registration-not-open': 'ההרשמה לא נפתחה',
    'workshop-hide': 'הסתרה מהאתר'
  };

  var versions = [];
  var versionAt = -1;
  var openGroup = '';
  var groupTimer;
  var restoring = false;

  /** Everything the form holds. Caret is kept aside so it never counts as a change. */
  function editorSnapshot() {
    var active = document.activeElement;
    var caret = active && typeof active.selectionStart === 'number'
      ? [active.selectionStart, active.selectionEnd]
      : null;

    return {
      fields: {
        title: titleInput.value,
        subtitle: subtitleInput.value,
        date: dateInput.value,
        slug: slugInput.value,
        image: imageInput.value,
        body: bodyInput.value,
        price_per: pricePerSelect.value,
        cart_price: priceInput.value,
        spots: spotsInput.value,
        form_url: formUrlInput.value,
        registration_full: fullInput.checked,
        last_places: lastPlacesInput.checked,
        registration_not_open: notOpenInput.checked,
        hide: hideInput.checked,
        packs: packRows()
      },
      focus: active && active.id ? active.id : '',
      caret: caret
    };
  }

  function applySnapshot(version) {
    var fields = version.fields;

    restoring = true;
    titleInput.value = fields.title;
    subtitleInput.value = fields.subtitle;
    dateInput.value = fields.date;
    slugInput.value = fields.slug;
    imageInput.value = fields.image;
    bodyInput.value = fields.body;
    pricePerSelect.value = fields.price_per;
    priceInput.value = fields.cart_price;
    spotsInput.value = fields.spots;
    formUrlInput.value = fields.form_url;
    fullInput.checked = fields.registration_full;
    lastPlacesInput.checked = fields.last_places;
    notOpenInput.checked = fields.registration_not_open;
    hideInput.checked = fields.hide;
    renderPacks(fields.packs);
    syncPricePer();
    restoring = false;

    // Putting the caret back where it was is what makes undoing a burst of
    // typing feel like undoing rather than like reloading the form.
    var focused = version.focus && document.getElementById(version.focus);
    if (focused && !focused.closest('[hidden]')) {
      focused.focus();
      if (version.caret && typeof focused.setSelectionRange === 'function') {
        try {
          focused.setSelectionRange(version.caret[0], version.caret[1]);
        } catch (error) {
          /* A number input refuses a selection range in some browsers. */
        }
      }
    }

    updatePreview();
  }

  function sameFields(a, b) {
    return JSON.stringify(a.fields) === JSON.stringify(b.fields);
  }

  function record(label, groupKey) {
    if (restoring || editor.hidden) return;

    var version = editorSnapshot();
    if (versionAt >= 0 && sameFields(versions[versionAt], version)) return;

    // Stepping back and then editing replaces what was undone: the versions
    // ahead described a future this edit has just ruled out.
    versions.length = versionAt + 1;

    var extendsGroup = groupKey && openGroup === groupKey && versionAt > 0;
    if (extendsGroup) {
      versions[versionAt] = { label: versions[versionAt].label, at: Date.now(), fields: version.fields, focus: version.focus, caret: version.caret };
    } else {
      versions.push({ label: label, at: Date.now(), fields: version.fields, focus: version.focus, caret: version.caret });
      if (versions.length > VERSION_LIMIT) versions.shift();
      versionAt = versions.length - 1;
    }

    openGroup = groupKey || '';
    clearTimeout(groupTimer);
    if (groupKey) {
      groupTimer = setTimeout(function () { openGroup = ''; }, TYPING_GROUP_MS);
    }

    renderHistory();
  }

  function resetHistory(label) {
    versions = [];
    versionAt = -1;
    openGroup = '';
    clearTimeout(groupTimer);

    var version = editorSnapshot();
    versions.push({ label: label, at: Date.now(), fields: version.fields, focus: '', caret: null });
    versionAt = 0;

    renderHistory();
  }

  function goToVersion(index) {
    if (index < 0 || index >= versions.length || index === versionAt) return;

    versionAt = index;
    openGroup = '';
    clearTimeout(groupTimer);
    applySnapshot(versions[index]);
    renderHistory();
  }

  function undo() {
    if (versionAt <= 0) return;
    goToVersion(versionAt - 1);
  }

  function redo() {
    if (versionAt >= versions.length - 1) return;
    goToVersion(versionAt + 1);
  }

  function versionTime(at) {
    var date = new Date(at);
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  function renderHistory() {
    if (!historyEl) return;

    // Newest first, so the step just taken is the one under the cursor rather
    // than the one furthest down a growing list.
    var rows = [];
    for (var index = versions.length - 1; index >= 0; index--) {
      var entry = versions[index];
      rows.push(
        '<li><button type="button" class="admin-history__item' +
        (index === versionAt ? ' is-current' : '') +
        (index > versionAt ? ' is-undone' : '') +
        '" data-version="' + index + '">' +
        '<span class="admin-history__label">' + escapeHtml(entry.label) + '</span>' +
        '<span class="admin-history__time" dir="ltr">' + versionTime(entry.at) + '</span>' +
        '</button></li>'
      );
    }

    historyEl.innerHTML = rows.join('');
    if (undoBtn) undoBtn.disabled = versionAt <= 0;
    if (redoBtn) redoBtn.disabled = versionAt >= versions.length - 1;
  }

  function openEditor(workshop) {
    var go = function () {
      fillEditor(workshop);
      listView.hidden = true;
      editor.hidden = false;
      window.scrollTo(0, 0);
      updatePreview();
    };

    if (isDirty()) {
      return saveSpots().then(go).catch(function (error) {
        show(boardMessage, error.message || 'לא הצלחנו לשמור את המקומות לפני העריכה', 'error');
      });
    }

    go();
  }

  function closeEditor() {
    current = null;
    editor.hidden = true;
    listView.hidden = false;
    show(editorMessage, '');
  }

  function load() {
    return api('GET').then(function (data) {
      workshops = data.workshops || [];
      original = snapshot(workshops);
      render();
      renderStats();
      board.hidden = false;
      loginForm.hidden = true;
      logoutBtn.hidden = false;

      if (saveHint) {
        show(boardMessage, saveHint, 'ok');
        saveHint = '';
      } else {
        show(boardMessage, '');
      }
    });
  }

  /* ------------------------------------------------------------------ events */

  loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var password = document.getElementById('admin-password').value;
    show(loginMessage, 'רגע...', 'info');

    request('/api/admin/', 'POST', { action: 'login', password: password })
      .then(load)
      .catch(function (error) {
        show(loginMessage, error.message, 'error');
      });
  });

  logoutBtn.addEventListener('click', function () {
    request('/api/admin/', 'POST', { action: 'logout' }).then(function () {
      window.location.reload();
    });
  });

  newBtn.addEventListener('click', function () {
    openEditor(null);
  });

  saveSpotsBtn.addEventListener('click', function () {
    saveSpots().catch(function (error) {
      show(boardMessage, error.message || 'לא הצלחנו לשמור', 'error');
      saveSpotsBtn.disabled = !isDirty();
    });
  });

  listEl.addEventListener('change', function (event) {
    var card = event.target.closest('[data-slug]');
    if (!card) return;
    var workshop = findWorkshop(card.getAttribute('data-slug'));
    if (!workshop) return;

    var spots = event.target.closest('input[data-spots]');
    if (spots) {
      var raw = spots.value.trim();
      if (raw === '') {
        workshop.spots = null;
      } else {
        var n = Number(raw);
        if (!Number.isInteger(n) || n < 0) {
          spots.value = workshop.spots == null ? '' : workshop.spots;
          return;
        }
        workshop.spots = n;
        workshop.registration_full = n === 0;
      }
      render();
      return;
    }

    var flag = event.target.closest('input[data-flag]');
    if (!flag) return;
    workshop[flag.getAttribute('data-flag')] = flag.checked;
    render();
  });

  listEl.addEventListener('click', function (event) {
    var button = event.target.closest('[data-edit]');
    if (!button) return;

    var workshop = findWorkshop(button.getAttribute('data-edit'));
    if (workshop) openEditor(workshop);
  });

  editorCancel.addEventListener('click', closeEditor);

  imagePick.addEventListener('click', function () { imageFile.click(); });
  bodyImagePick.addEventListener('click', function () { bodyImageFile.click(); });

  imageFile.addEventListener('change', function () {
    handlePicked(imageFile, function (url) {
      imageInput.value = url;
      record('העלאת תמונה ראשית', '');
    });
  });

  bodyImageFile.addEventListener('change', function () {
    handlePicked(bodyImageFile, function (url) {
      insertAtCaret(bodyInput, '\n\n![](' + url + ')\n\n');
      record('הוספת תמונה לטקסט', '');
    });
  });

  linkPick.addEventListener('click', function () {
    if (linkBox.hidden) openLinkBox();
    else closeLinkBox();
  });

  linkCancel.addEventListener('click', closeLinkBox);
  linkInsert.addEventListener('click', insertLink);

  linkUrlInput.addEventListener('input', function () {
    linkMatches = searchLinks(linkUrlInput.value);
    linkActive = -1;
    renderLinkResults();
  });

  linkUrlInput.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!linkMatches.length) return;
      event.preventDefault();
      var step = event.key === 'ArrowDown' ? 1 : -1;
      linkActive = (linkActive + step + linkMatches.length) % linkMatches.length;
      renderLinkResults();
      return;
    }

    if (event.key === 'Enter') {
      // Enter inside the editor form would otherwise submit and save.
      event.preventDefault();
      if (linkActive >= 0 && linkMatches[linkActive]) chooseLink(linkMatches[linkActive]);
      else insertLink();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeLinkBox();
    }
  });

  linkResults.addEventListener('click', function (event) {
    var button = event.target.closest('[data-link-index]');
    if (!button) return;

    var entry = linkMatches[Number(button.getAttribute('data-link-index'))];
    if (entry) chooseLink(entry);
  });

  linkTextInput.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    insertLink();
  });

  slugInput.addEventListener('input', function () {
    if (slugInput.readOnly) return;
    slugInput.value = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  });

  pricePerSelect.addEventListener('change', syncPricePer);

  spotsInput.addEventListener('input', function () {
    // Zero places and "registration full" are the same fact; keeping them in
    // step here means the preview cannot disagree with what will be saved.
    var raw = String(spotsInput.value || '').trim();
    if (raw === '0') fullInput.checked = true;
    else if (raw !== '' && Number(raw) > 0) fullInput.checked = false;
  });

  addPackBtn.addEventListener('click', function () {
    var count = packsEl.querySelectorAll('.admin-pack').length;
    if (count >= MAX_PACKS) {
      show(editorMessage, 'אפשר עד ' + MAX_PACKS + ' חבילות', 'error');
      return;
    }
    packsEl.insertAdjacentHTML('beforeend', packRowHtml({ places: 1 }, count));
    schedulePreview();
    record('הוספת חבילה', '');
  });

  packsEl.addEventListener('click', function (event) {
    var remove = event.target.closest('[data-remove-pack]');
    if (!remove) return;
    var row = remove.closest('.admin-pack');
    if (row) row.remove();
    renumberPacks();
    schedulePreview();
    record('הסרת חבילה', '');
  });

  /** True for the fields where a keystroke is one of many, not one decision. */
  function isTyping(el) {
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    return el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'file';
  }

  function recordFromEvent(event, typing) {
    var el = event.target;
    if (!el || !el.tagName || el.type === 'file') return;

    var inPack = el.closest && el.closest('.admin-pack');
    var label = inPack ? 'חבילות הרשמה' : FIELD_LABELS[el.id];
    if (!label) return;

    record(label, typing && isTyping(el) ? (inPack ? 'packs' : el.id) : '');
  }

  editor.addEventListener('input', function (event) {
    schedulePreview();
    recordFromEvent(event, true);
  });

  editor.addEventListener('change', function (event) {
    schedulePreview();
    recordFromEvent(event, false);
  });

  if (historyEl) {
    historyEl.addEventListener('click', function (event) {
      var button = event.target.closest('[data-version]');
      if (button) goToVersion(Number(button.getAttribute('data-version')));
    });
  }

  if (undoBtn) undoBtn.addEventListener('click', undo);
  if (redoBtn) redoBtn.addEventListener('click', redo);

  document.addEventListener('keydown', function (event) {
    if (editor.hidden || !(event.ctrlKey || event.metaKey) || event.altKey) return;

    // event.key follows the keyboard layout — on a Hebrew one the Z key types
    // ז — so the shortcut is matched on the physical key instead.
    var key = String(event.key || '').toLowerCase();
    var isUndoKey = event.code === 'KeyZ' || key === 'z' || key === 'ז';
    var isRedoKey = event.code === 'KeyY' || key === 'y' || key === 'ט';
    if (!isUndoKey && !isRedoKey) return;

    event.preventDefault();
    if (isRedoKey || event.shiftKey) redo();
    else undo();
  });

  editor.addEventListener('submit', function (event) {
    event.preventDefault();

    var payload = { action: 'save', workshop: readEditor() };
    if (current) payload.slug = current.slug;

    if (!payload.workshop.title) {
      show(editorMessage, 'צריך שם לסדנה', 'error');
      titleInput.focus();
      return;
    }

    saveBtn.disabled = true;
    show(editorMessage, 'שומרת...', 'info');

    api('POST', payload)
      .then(function (data) {
        return load().then(function () {
          var saved = findWorkshop(data.slug);
          fillEditor(saved, 'נשמר');
          updatePreview();
          show(editorMessage, savedMessage(data, 'נשמר.'), 'ok');
        });
      })
      .catch(function (error) {
        show(editorMessage, error.message, 'error');
      })
      .then(function () {
        saveBtn.disabled = false;
      });
  });

  editorDelete.addEventListener('click', function () {
    if (!current) return;
    if (!window.confirm(
      'למחוק את "' + current.title + '"? העמוד יירד מהאתר.\n' +
      'לסדנה שכבר התקיימה עדיף «הסתר מהאתר» — כך קישור שנשלח לנרשמת עדיין עובד.'
    )) return;

    editorDelete.disabled = true;
    show(editorMessage, 'מוחקת...', 'info');

    api('POST', { action: 'delete', slug: current.slug })
      .then(function (data) {
        saveHint = savedMessage(data, 'הסדנה נמחקה.');
        return load().then(closeEditor);
      })
      .catch(function (error) {
        show(editorMessage, error.message, 'error');
      })
      .then(function () {
        editorDelete.disabled = false;
      });
  });

  // An existing session skips the password prompt.
  load().catch(function () {
    loginForm.hidden = false;
  });
})();
