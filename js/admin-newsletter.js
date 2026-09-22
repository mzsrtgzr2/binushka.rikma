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
  var previewEl = document.getElementById('issue-preview');
  var sendStateEl = document.getElementById('issue-send-state');
  var testToInput = document.getElementById('issue-test-to');
  var sendTestBtn = document.getElementById('issue-send-test');
  var sendBtn = document.getElementById('issue-send');
  if (!loginForm || !board || !editor) return;

  var issues = [];
  var current = null;
  var state = {};
  var previewTimer;

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
        if (!res.ok) throw new Error(data.error || errorText(data.code) || 'שגיאה');
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
        'זו סביבת preview שמחוברת לרשימת הנמענים האמיתית. אפשר לשלוח מכאן בדיקה לכתובת אחת; שליחה לכל הרשימה רק מהאתר עצמו',
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
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
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

  function renderStats() {
    if (!statsEl) return;

    var parts = [];
    if (typeof state.subscribers === 'number') parts.push(state.subscribers + ' נמענים ברשימה');
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
    editorDelete.hidden = !issue || sent;
    sendBtn.disabled = sent || !state.canSend;
    sendTestBtn.disabled = !issue || !state.canSend;

    if (sent) {
      sendStateEl.textContent = 'נשלח ב־' + formatDate(issue.sent_at) +
        (issue.recipients ? ' אל ' + issue.recipients + ' נמענים' : '') +
        '. עריכה כאן מתקנת את הארכיון באתר בלבד — הגיליון לא נשלח שוב.';
    } else if (!issue) {
      sendStateEl.textContent = 'צריך לשמור את הגיליון לפני שאפשר לשלוח אותו.';
    } else if (!state.canSend) {
      sendStateEl.textContent = 'שליחה מושבתת עד שיוגדרו פרטי השליחה.';
    } else {
      sendStateEl.textContent = 'טיוטה. שליחה תצא אל ' + (state.subscribers || 0) + ' נמענים.';
    }

    show(editorMessage, '');
    listView.hidden = true;
    editor.hidden = false;
    updatePreview();
  }

  function closeEditor() {
    current = null;
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

  listEl.addEventListener('click', function (event) {
    var slug = event.target.getAttribute('data-edit');
    if (!slug) return;

    var issue = issues.filter(function (item) { return item.slug === slug; })[0];
    if (issue) openEditor(issue);
  });

  editorCancel.addEventListener('click', closeEditor);

  thumbnailPick.addEventListener('click', function () { thumbnailFile.click(); });
  imagePick.addEventListener('click', function () { imageFile.click(); });

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

  sendTestBtn.addEventListener('click', function () {
    if (!current) return;

    var testTo = testToInput.value.trim();
    if (!testTo) {
      show(editorMessage, 'צריך כתובת לשליחת הבדיקה', 'error');
      return;
    }

    show(editorMessage, 'שולחת בדיקה...', 'info');

    api('POST', { action: 'send', slug: current.slug, testTo: testTo })
      .then(function (data) {
        if (data.failed && data.failed.length) {
          show(editorMessage, 'השליחה נכשלה: ' + data.failed[0].message, 'error');
          return;
        }
        show(editorMessage, 'נשלחה בדיקה אל ' + testTo, 'ok');
      })
      .catch(function (error) {
        show(editorMessage, error.message, 'error');
      });
  });

  sendBtn.addEventListener('click', function () {
    if (!current) return;

    var total = state.subscribers || 0;
    if (!window.confirm('לשלוח את "' + current.title + '" אל ' + total + ' נמענים? אי אפשר לבטל.')) return;

    show(editorMessage, 'שולחת... זה יכול לקחת כמה דקות.', 'info');
    sendBtn.disabled = true;

    api('POST', { action: 'send', slug: current.slug })
      .then(function (data) {
        var message = 'נשלח אל ' + data.sent + ' נמענים.';
        if (data.remaining) message += ' נשארו ' + data.remaining + ' — אפשר ללחוץ שוב כדי להמשיך.';
        if (data.failed && data.failed.length) message += ' ' + data.failed.length + ' נכשלו.';

        return load().then(function () {
          var saved = issues.filter(function (item) { return item.slug === current.slug; })[0];
          openEditor(saved || null);
          show(editorMessage, message, data.failed && data.failed.length ? 'error' : 'ok');
        });
      })
      .catch(function (error) {
        sendBtn.disabled = false;
        show(editorMessage, error.message, 'error');
      });
  });

  // An existing session skips the password prompt.
  load().catch(function () {
    loginForm.hidden = false;
  });
})();
