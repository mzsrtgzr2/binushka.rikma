/**
 * Newsletter backoffice: login, list issues, write one in Markdown, send it.
 *
 * Login posts to /api/admin/ because that handler owns the session cookie; the
 * newsletter endpoint only verifies it. One password, both screens.
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
  var logoutBtn = document.getElementById('admin-logout');
  var editor = document.getElementById('admin-editor');
  var editorTitle = document.getElementById('admin-editor-title');
  var editorMessage = document.getElementById('admin-editor-message');
  var editorCancel = document.getElementById('admin-editor-cancel');
  var editorDelete = document.getElementById('admin-editor-delete');
  var titleInput = document.getElementById('issue-title');
  var subtitleInput = document.getElementById('issue-subtitle');
  var thumbnailInput = document.getElementById('issue-thumbnail');
  var bodyInput = document.getElementById('issue-body');
  var promotionalInput = document.getElementById('issue-promotional');
  var thumbnailPick = document.getElementById('issue-thumbnail-pick');
  var thumbnailFile = document.getElementById('issue-thumbnail-file');
  var imagePick = document.getElementById('issue-image-pick');
  var imageFile = document.getElementById('issue-image-file');
  var linkPick = document.getElementById('issue-link-pick');
  var linkBox = document.getElementById('issue-linkbox');
  var linkTextInput = document.getElementById('issue-link-text');
  var linkUrlInput = document.getElementById('issue-link-url');
  var linkResults = document.getElementById('issue-link-results');
  var linkInsert = document.getElementById('issue-link-insert');
  var linkCancel = document.getElementById('issue-link-cancel');
  var previewEl = document.getElementById('issue-preview');
  var sendStateEl = document.getElementById('issue-send-state');
  var testToInput = document.getElementById('issue-test-to');
  var sendTestBtn = document.getElementById('issue-send-test');
  var sendBtn = document.getElementById('issue-send');
  var sendMessageEl = document.getElementById('issue-send-message');
  var recipientsEl = document.getElementById('issue-recipients');
  var recipientsSummaryEl = document.getElementById('issue-recipients-summary');
  var recipientsFilterEl = document.getElementById('issue-recipients-filter');
  var recipientsListEl = document.getElementById('issue-recipients-list');
  var recipientsRemovedEl = document.getElementById('issue-recipients-removed');
  if (!loginForm || !board || !editor) return;

  var issues = [];
  var current = null;
  var state = {};
  var previewTimer;
  // Addresses dropped from the send that is about to go out. They stay on the
  // subscriber list; the next issue starts with everyone again.
  var omitted = {};
  var recipientFilter = '';
  var recipientsLoading = false;

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
          var err = new Error(data.error || errorText(data.code) || 'שגיאה');
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function api(method, body) {
    return request('/api/admin-newsletter', method, body);
  }

  function errorText(code) {
    var messages = {
      unauthorized: 'צריך להתחבר',
      no_write_target: 'חסרה הגדרת GITHUB_TOKEN — אי אפשר לשמור גיליונות',
      not_configured: 'חסרות הגדרות של רשימת התפוצה',
      mailer_not_configured: 'חסרות הגדרות שליחה (GMAIL_USER / GMAIL_APP_PASSWORD)',
      no_recipients: 'אין אף נמען ברשימה',
      already_sent: 'הגיליון הזה כבר נשלח',
      preview_send_blocked:
        'זו סביבת preview שמחוברת לרשימת הנמענים האמיתית. כדי לשלוח מכאן, הגדירי NEWSLETTER_RECIPIENT_OVERRIDE עם הכתובות לבדיקה. בלי זה אפשר רק בדיקה לכתובת אחת',
      slug_taken: 'כבר קיים גיליון עם הכתובת הזאת',
      title_required: 'צריך כותרת'
    };
    return messages[code] || '';
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

  /** Drops text where the caret is rather than at the end of the issue. */
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

      // A title that begins with what was typed is almost always the one
      // meant, so it outranks a match buried in the middle or in the address.
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
    // The title is the obvious link text, but only when nothing was selected
    // in the body and nothing has been typed by hand.
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
    var selectionLength = bodyInput.selectionEnd - bodyInput.selectionStart;

    // Replaces the selection when the link was built around one, so the words
    // do not end up written twice.
    if (selectionLength > 0) {
      var start = bodyInput.selectionStart;
      bodyInput.value =
        bodyInput.value.slice(0, start) + '[' + text + '](' + url + ')' + bodyInput.value.slice(bodyInput.selectionEnd);
      bodyInput.selectionStart = bodyInput.selectionEnd = start + text.length + url.length + 4;
    } else {
      insertAtCaret(bodyInput, '[' + text + '](' + url + ')');
    }

    closeLinkBox();
    updatePreview();
  }

  /* ---------------------------------------------------------------- markdown

     Covers the subset documented under the editor. The mail itself is rendered
     server-side by a full Markdown parser, so this is a preview, not the
     source of truth. */
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
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (match, label, url) {
          var safe = /^(https?:|mailto:|\/(?!\/)|#)/i.test(url) ? url : '#';
          return '<a href="' + safe + '" target="_blank" rel="noopener">' + label + '</a>';
        })
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    }

    function flushParagraph() {
      if (!paragraph.length) return;
      html += '<p>' + inline(paragraph.join(' ')) + '</p>';
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

  function updatePreview() {
    if (!previewEl) return;

    var title = titleInput.value.trim();
    var subtitle = subtitleInput.value.trim();
    var thumbnail = thumbnailInput.value.trim();

    previewEl.innerHTML =
      (thumbnail ? '<img class="admin-preview__hero" src="' + escapeHtml(previewSrc(thumbnail)) + '" alt="">' : '') +
      '<h1>' + escapeHtml(title || 'ללא כותרת') + '</h1>' +
      (subtitle ? '<p class="admin-preview__subtitle">' + escapeHtml(subtitle) + '</p>' : '') +
      renderMarkdown(bodyInput.value) +
      '<hr><p class="admin-preview__footer">בינושקה · אומנות הרקמה<br>להסרה מרשימת התפוצה</p>';
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 150);
  }

  /* -------------------------------------------------------------------- list */

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
    } catch (e) {
      return date.toLocaleDateString();
    }
  }

  function overrideEmails() {
    return Array.isArray(state.recipientOverride) ? state.recipientOverride : null;
  }

  function renderStats() {
    if (!statsEl) return;

    var parts = [];
    var emails = overrideEmails();
    if (emails && emails.length) {
      parts.push('preview: שליחה רק אל ' + emails.join(', '));
    } else if (emails) {
      parts.push('preview: NEWSLETTER_RECIPIENT_OVERRIDE בלי כתובת תקינה');
    } else if (typeof state.subscribers === 'number') {
      parts.push(state.subscribers + ' נמענים ברשימה');
    }
    if (state.recipientOverrideIgnored) {
      parts.push('NEWSLETTER_RECIPIENT_OVERRIDE מוגדר ולא חל כאן — השליחה יוצאת לכל הרשימה');
    }
    if (state.sender) parts.push('נשלח מ־' + state.sender);
    if (!state.canSend) parts.push('שליחה מושבתת — חסרות הגדרות');

    statsEl.textContent = parts.join(' · ');
  }

  function render() {
    listEl.innerHTML = issues.map(function (issue) {
      var sent = issue.status === 'sent';
      return (
        '<li class="admin-card admin-card--issue">' +
        (issue.thumbnail
          ? '<img class="admin-card__thumb" src="' + escapeHtml(issue.thumbnail) + '" alt="">'
          : '<span class="admin-card__thumb admin-card__thumb--empty"></span>') +
        '<div class="admin-card__main">' +
        '<div class="admin-card__heading">' +
        '<strong>' + escapeHtml(issue.title) + '</strong>' +
        '<span class="admin-card__badge admin-card__badge--' + (sent ? 'sent' : 'draft') + '">' +
        (sent ? 'נשלח' : 'טיוטה') +
        '</span>' +
        '</div>' +
        (issue.subtitle ? '<p class="admin-card__meta">' + escapeHtml(issue.subtitle) + '</p>' : '') +
        '<p class="admin-hint">' +
        escapeHtml(formatDate(sent ? issue.sent_at || issue.date : issue.date)) +
        (sent && issue.recipients ? ' · ' + issue.recipients + ' נמענים' : '') +
        '</p>' +
        '</div>' +
        '<button type="button" class="button" data-edit="' + escapeHtml(issue.slug) + '">עריכה</button>' +
        '</li>'
      );
    }).join('');

    if (!issues.length) {
      listEl.innerHTML = '<li class="admin-hint">עוד אין גיליונות. אפשר להתחיל מ"גיליון חדש".</li>';
    }
  }

  /* ------------------------------------------------------------------ editor */

  function openEditor(issue) {
    var nextSlug = issue && issue.slug;
    var prevSlug = current && current.slug;
    if (nextSlug !== prevSlug) {
      omitted = {};
      recipientFilter = '';
      if (recipientsFilterEl) recipientsFilterEl.value = '';
    }
    current = issue;

    var sent = issue && issue.status === 'sent';
    editorTitle.textContent = issue ? issue.title : 'גיליון חדש';
    titleInput.value = issue ? issue.title : '';
    subtitleInput.value = issue ? issue.subtitle : '';
    thumbnailInput.value = issue ? issue.thumbnail : '';
    bodyInput.value = issue ? issue.body : '';
    promotionalInput.checked = issue ? issue.promotional !== false : true;

    // A sent issue stays editable so a typo can be corrected in the archive.
    // What it cannot do is go out again or disappear: the copies already in
    // people's inboxes are not coming back either way.
    linkBox.hidden = true;
    editorDelete.hidden = !issue || sent;
    var emails = overrideEmails();
    sendTestBtn.disabled = !issue || !state.canSend;
    syncSendButton();

    if (sent) {
      sendStateEl.textContent = 'נשלח ב־' + formatDate(issue.sent_at) +
        (issue.recipients ? ' אל ' + issue.recipients + ' נמענים' : '') +
        '. עריכה כאן מתקנת את הארכיון באתר בלבד — הגיליון לא נשלח שוב.';
    } else if (!issue) {
      sendStateEl.textContent = 'צריך לשמור את הגיליון לפני שאפשר לשלוח אותו.';
    } else if (emails && !emails.length) {
      sendStateEl.textContent = 'NEWSLETTER_RECIPIENT_OVERRIDE מוגדר בלי כתובת תקינה, אז אין לאן לשלוח.';
    } else if (!state.canSend) {
      sendStateEl.textContent = 'שליחה מושבתת עד שיוגדרו פרטי השליחה.';
    } else if (emails) {
      sendStateEl.textContent = 'סביבת preview. השליחה תצא רק אל: ' + emails.join(', ') +
        '. הרשימה הרשומה לא תקבל את המייל, והגיליון יישאר טיוטה.';
    } else {
      sendStateEl.textContent = 'טיוטה. שליחה תצא אל ' + (state.subscribers || 0) + ' נמענים.';
    }

    show(editorMessage, '');
    show(sendMessageEl, '');
    listView.hidden = true;
    editor.hidden = false;
    updatePreview();
    loadRecipients(nextSlug);
  }

  function fullRecipients() {
    return Array.isArray(state.recipients) ? state.recipients : null;
  }

  function selectedRecipients() {
    var all = fullRecipients();
    if (!all) return null;
    return all.filter(function (email) { return !omitted[email]; });
  }

  function syncSendButton() {
    if (!sendBtn) return;
    var sent = current && current.status === 'sent';
    var emails = overrideEmails();
    var selected = selectedRecipients();
    var all = fullRecipients();
    var noneLeft = Array.isArray(selected) && selected.length === 0;
    sendBtn.disabled = !current || sent || !state.canSend || Boolean(emails && !emails.length) || recipientsLoading || noneLeft;

    if (!sendBtn.getAttribute('data-label')) sendBtn.setAttribute('data-label', sendBtn.textContent);
    var trimmed = all && selected && selected.length !== all.length;
    if (trimmed) sendBtn.textContent = 'שליחה אל ' + selected.length;
    else if (emails && emails.length) sendBtn.textContent = 'שליחה לכתובות הבדיקה';
    else sendBtn.textContent = sendBtn.getAttribute('data-label');
  }

  function recipientRow(email, restore) {
    return (
      '<li class="admin-recipients__item">' +
      '<span class="admin-recipients__email">' + escapeHtml(email) + '</span>' +
      '<button type="button" ' + (restore ? 'data-restore' : 'data-omit') + '="' + escapeHtml(email) + '">' +
      (restore ? 'החזרה' : 'הסרה') +
      '</button></li>'
    );
  }

  function renderRecipients() {
    if (!recipientsEl) return;
    var all = fullRecipients();
    if (!all) {
      if (!recipientsLoading) recipientsEl.hidden = true;
      return;
    }

    recipientsEl.hidden = false;
    var selected = selectedRecipients();
    var removed = all.filter(function (email) { return omitted[email]; });
    var query = recipientFilter;
    var visible = selected.filter(function (email) { return !query || email.indexOf(query) !== -1; });

    if (recipientsLoading) {
      recipientsSummaryEl.textContent = 'טוענת את הרשימה...';
    } else if (!all.length) {
      recipientsSummaryEl.textContent = 'אין כתובות ברשימה.';
    } else if (!selected.length) {
      recipientsSummaryEl.textContent = 'כולן הוסרו מהשליחה הזו. הן נשארות ברשימה לפעם הבאה.';
    } else if (removed.length) {
      recipientsSummaryEl.textContent = 'יישלח אל ' + selected.length + ' מתוך ' + all.length +
        '. הסרה כאן חלה רק על השליחה הזו — הכתובת נשארת ברשימה.';
    } else {
      recipientsSummaryEl.textContent = 'יישלח אל ' + selected.length +
        (selected.length === 1 ? ' כתובת.' : ' כתובות.') +
        ' אפשר להסיר כתובת מהשליחה הזו בלי להוריד אותה מהרשימה.';
    }

    recipientsFilterEl.hidden = all.length < 6;
    recipientsListEl.innerHTML = visible.map(function (email) { return recipientRow(email, false); }).join('');
    if (query && !visible.length && selected.length) {
      recipientsListEl.innerHTML = '<li class="admin-recipients__item"><span class="admin-hint">אין כתובת שמתאימה לסינון.</span></li>';
    }
    recipientsRemovedEl.hidden = !removed.length;
    recipientsRemovedEl.innerHTML = removed.map(function (email) { return recipientRow(email, true); }).join('');
  }

  function loadRecipients(slug) {
    var sent = current && current.status === 'sent';
    var emails = overrideEmails();
    var canEdit = Boolean(current && current.slug && !sent && state.canSend && !(emails && !emails.length));
    if (!canEdit) {
      recipientsLoading = false;
      state.recipients = null;
      if (recipientsEl) recipientsEl.hidden = true;
      syncSendButton();
      return;
    }

    recipientsLoading = true;
    state.recipients = null;
    recipientsEl.hidden = false;
    recipientsSummaryEl.textContent = 'טוענת את הרשימה...';
    recipientsListEl.innerHTML = '';
    recipientsRemovedEl.hidden = true;
    recipientsFilterEl.hidden = true;
    syncSendButton();

    api('POST', { action: 'recipients' })
      .then(function (data) {
        if (!current || current.slug !== slug) return;
        recipientsLoading = false;
        if (data.blocked) {
          state.recipients = null;
          recipientsEl.hidden = true;
        } else {
          state.recipients = data.recipients || [];
          var known = {};
          state.recipients.forEach(function (email) { known[email] = true; });
          Object.keys(omitted).forEach(function (email) { if (!known[email]) delete omitted[email]; });
          renderRecipients();
        }
        syncSendButton();
      })
      .catch(function () {
        if (!current || current.slug !== slug) return;
        recipientsLoading = false;
        state.recipients = null;
        recipientsEl.hidden = false;
        recipientsSummaryEl.textContent = 'לא הצלחנו לטעון את הכתובות. השליחה תצא לכל הרשימה.';
        recipientsListEl.innerHTML = '';
        recipientsRemovedEl.hidden = true;
        syncSendButton();
      });
  }

  function closeEditor() {
    current = null;
    omitted = {};
    recipientFilter = '';
    recipientsLoading = false;
    editor.hidden = true;
    listView.hidden = false;
    show(editorMessage, '');
  }

  function readEditor() {
    return {
      title: titleInput.value.trim(),
      subtitle: subtitleInput.value.trim(),
      thumbnail: thumbnailInput.value.trim(),
      body: bodyInput.value,
      promotional: promotionalInput.checked
    };
  }

  function load() {
    return api('GET').then(function (data) {
      issues = data.issues || [];
      state = data;
      render();
      renderStats();
      board.hidden = false;
      loginForm.hidden = true;
      logoutBtn.hidden = false;
      show(boardMessage, '');
    });
  }

  /* ------------------------------------------------------------------ events */

  function loginQueryMessage(login) {
    if (!login) return '';
    if (login.kind === 'locked') return 'יותר מדי ניסיונות שגויים. נסי שוב בעוד כמה דקות';
    if (login.kind === 'ok') {
      return 'הסיסמה נכונה, אבל הדפדפן לא שמר את החיבור. נסי שוב מאותו חלון, בלי מצב פרטי.';
    }
    if (login.kind !== 'error') return '';
    var message = 'סיסמה שגויה';
    if (login.envName && login.envName !== 'production') {
      message += '. ב-Preview הסיסמה היא ADMIN_PASSWORD של סביבת Preview, לא של Production. אחרי שינוי צריך Redeploy.';
    }
    return message;
  }

  function takeLoginQuery() {
    var params = new URLSearchParams(window.location.search);
    var kind = params.get('login');
    var login = kind === 'error' || kind === 'locked' || kind === 'ok' ? { kind: kind, envName: params.get('env') || '' } : null;
    if (login && history.replaceState) history.replaceState({}, '', window.location.pathname);
    return login;
  }

  logoutBtn.addEventListener('click', function () {
    var form = document.createElement('form');
    form.method = 'post';
    form.action = loginForm.getAttribute('action') || '/api/admin/';
    [['action', 'logout'], ['next', window.location.pathname]].forEach(function (pair) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = pair[0];
      input.value = pair[1];
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  });

  newBtn.addEventListener('click', function () {
    openEditor(null);
  });

  listEl.addEventListener('click', function (event) {
    var slug = event.target.getAttribute('data-edit');
    if (!slug) return;

    var issue = issues.filter(function (item) { return item.slug === slug; })[0];
    if (issue) openEditor(issue);
  });

  editorCancel.addEventListener('click', closeEditor);

  thumbnailPick.addEventListener('click', function () { thumbnailFile.click(); });
  imagePick.addEventListener('click', function () { imageFile.click(); });

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

  thumbnailFile.addEventListener('change', function () {
    handlePicked(thumbnailFile, function (url) {
      thumbnailInput.value = url;
    });
  });

  imageFile.addEventListener('change', function () {
    handlePicked(imageFile, function (url) {
      insertAtCaret(bodyInput, '\n\n![](' + url + ')\n\n');
    });
  });

  [titleInput, subtitleInput, thumbnailInput, bodyInput].forEach(function (field) {
    field.addEventListener('input', schedulePreview);
  });

  editor.addEventListener('submit', function (event) {
    event.preventDefault();

    var payload = { action: 'save', issue: readEditor() };
    if (current) payload.slug = current.slug;

    if (!payload.issue.title) {
      show(editorMessage, 'צריך כותרת', 'error');
      return;
    }

    show(editorMessage, 'שומרת...', 'info');

    api('POST', payload)
      .then(function (data) {
        return load().then(function () {
          var saved = issues.filter(function (item) { return item.slug === data.slug; })[0];
          openEditor(saved || null);
          show(editorMessage, 'נשמר. האתר יתעדכן בעוד רגע.', 'ok');
        });
      })
      .catch(function (error) {
        show(editorMessage, error.message, 'error');
      });
  });

  editorDelete.addEventListener('click', function () {
    if (!current) return;
    if (!window.confirm('למחוק את הטיוטה "' + current.title + '"?')) return;

    show(editorMessage, 'מוחקת...', 'info');

    api('POST', { action: 'delete', slug: current.slug })
      .then(function () {
        return load().then(closeEditor);
      })
      .catch(function (error) {
        show(editorMessage, error.message, 'error');
      });
  });

  // The form is long, and the message under the title is off screen by the time
  // someone reaches these buttons. The result has to sit next to the click.
  function reportSend(text, type) {
    show(sendMessageEl, text, type);
  }

  // Names every address the send actually reached, and every one it did not.
  function sendReport(data, lead) {
    var lines = [];
    if (lead) lines.push(lead);

    var sentTo = data.sentTo || [];
    if (sentTo.length) {
      lines.push('נשלח אל:');
      sentTo.forEach(function (email) { lines.push(email); });
    }

    var failed = data.failed || [];
    if (failed.length) {
      lines.push('נכשל:');
      failed.forEach(function (item) {
        lines.push((item.email || 'נמען') + (item.message ? ' — ' + item.message : ''));
      });
    }

    if (!sentTo.length && !failed.length) lines.push('לא נשלח לאף כתובת.');
    var skipped = data.omitted || [];
    if (skipped.length) {
      lines.push('לא נשלח הפעם:');
      skipped.forEach(function (email) { lines.push(email); });
      lines.push('הכתובות האלה נשארו ברשימה.');
    }
    if (data.remaining) lines.push('נשארו ' + data.remaining + ' — אפשר ללחוץ שוב כדי להמשיך.');
    if (data.override) lines.push('הרשימה הרשומה לא קיבלה את המייל. הגיליון נשאר טיוטה.');
    return lines.join('\n');
  }

  function holdButton(button, label) {
    var restore = button.textContent;
    button.disabled = true;
    button.textContent = label;
    return function () {
      button.textContent = restore;
    };
  }

  sendTestBtn.addEventListener('click', function () {
    if (!current) return;

    var testTo = testToInput.value.trim();
    if (!testTo) {
      reportSend('צריך כתובת לשליחת הבדיקה', 'error');
      return;
    }

    var release = holdButton(sendTestBtn, 'שולחת...');
    reportSend('שולחת בדיקה אל ' + testTo + '...', 'info');

    api('POST', { action: 'send', slug: current.slug, testTo: testTo })
      .then(function (data) {
        var failed = data.failed && data.failed.length;
        reportSend(sendReport(data, failed && !(data.sentTo && data.sentTo.length) ? 'השליחה נכשלה.' : 'נשלחה בדיקה.'), failed ? 'error' : 'ok');
      })
      .catch(function (error) {
        reportSend(error.message, 'error');
      })
      .then(function () {
        release();
        sendTestBtn.disabled = !current || !state.canSend;
      });
  });

  if (recipientsEl) {
    recipientsEl.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button) return;
      var drop = button.getAttribute('data-omit');
      var restore = button.getAttribute('data-restore');
      if (drop) omitted[drop] = true;
      else if (restore) delete omitted[restore];
      else return;
      renderRecipients();
      syncSendButton();
    });
  }

  if (recipientsFilterEl) {
    recipientsFilterEl.addEventListener('input', function () {
      recipientFilter = recipientsFilterEl.value.trim().toLowerCase();
      renderRecipients();
    });
    recipientsFilterEl.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') event.preventDefault();
    });
  }

  sendBtn.addEventListener('click', function () {
    if (!current) return;

    var emails = overrideEmails();
    if (emails && !emails.length) {
      reportSend('אין כתובת תקינה ב-NEWSLETTER_RECIPIENT_OVERRIDE.', 'error');
      return;
    }

    var selected = selectedRecipients();
    var all = fullRecipients();
    if (selected && !selected.length) {
      reportSend('אין כתובת בשליחה הזו.', 'error');
      return;
    }

    var removedCount = all && selected ? all.length - selected.length : 0;
    var question;
    if (selected) {
      var lines = ['לשלוח את "' + current.title + '" אל:'];
      if (selected.length <= 12) selected.forEach(function (email) { lines.push(email); });
      else lines.push(selected.length + ' נמענים');
      if (removedCount) {
        lines.push('');
        lines.push(removedCount === 1
          ? 'כתובת אחת הוסרה מהשליחה הזו ונשארה ברשימה.'
          : removedCount + ' כתובות הוסרו מהשליחה הזו ונשארו ברשימה.');
      }
      lines.push('');
      lines.push(emails
        ? 'הרשימה הרשומה לא תקבל את המייל, והגיליון יישאר טיוטה.'
        : 'אי אפשר לבטל.');
      question = lines.join('\n');
    } else {
      var total = state.subscribers || 0;
      question = 'לשלוח את "' + current.title + '" אל ' + total + ' נמענים? אי אפשר לבטל.';
    }
    if (!window.confirm(question)) return;

    var omit = [];
    if (all) all.forEach(function (email) { if (omitted[email]) omit.push(email); });

    var release = holdButton(sendBtn, 'שולחת...');
    reportSend(
      selected
        ? (selected.length <= 12 ? 'שולחת אל: ' + selected.join(', ') : 'שולחת אל ' + selected.length + ' נמענים.')
        : 'שולחת אל ' + (state.subscribers || 0) + ' נמענים. זה יכול לקחת כמה דקות.',
      'info'
    );

    api('POST', { action: 'send', slug: current.slug, omit: omit })
      .then(function (data) {
        var failed = data.failed && data.failed.length;
        var count = data.sent || 0;
        var lead = data.override
          ? 'נשלח אל ' + count + (count === 1 ? ' כתובת בדיקה.' : ' כתובות בדיקה.')
          : 'נשלח אל ' + count + (count === 1 ? ' נמען.' : ' נמענים.');

        omitted = {};
        return load().then(function () {
          var saved = issues.filter(function (item) { return item.slug === current.slug; })[0];
          openEditor(saved || null);
          reportSend(sendReport(data, lead), failed ? 'error' : 'ok');
        });
      })
      .catch(function (error) {
        reportSend(error.message, 'error');
      })
      .then(function () {
        release();
        // A successful send reloads the issue as sent and leaves the button off.
        // A failure has to hand it back, since holdButton disabled it.
        syncSendButton();
      });
  });

  // An existing session skips the password prompt. Login itself is a real
  // form POST so the browser keeps the HttpOnly cookie.
  load().catch(function (error) {
    var login = takeLoginQuery();
    if (!error || error.status === 401) {
      loginForm.hidden = false;
      var message = loginQueryMessage(login);
      if (message) show(loginMessage, message, login.kind === 'ok' ? 'info' : 'error');
      return;
    }
    board.hidden = false;
    loginForm.hidden = true;
    logoutBtn.hidden = false;
    var boardText = (error && error.message) || 'לא הצלחנו לטעון. נסי לרענן.';
    if (login && login.kind === 'ok') boardText = 'התחברת. ' + boardText;
    show(boardMessage, boardText, 'error');
  });
})();
