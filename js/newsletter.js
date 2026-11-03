/* Newsletter signup and self-serve unsubscribe.
   The issue teaser and archive are rendered by Jekyll from the `newsletter`
   collection, so nothing here fetches them. */
(function () {
  'use strict';

  var configElement = document.getElementById('newsletter-config');
  if (!configElement) return;

  var config;
  try {
    config = JSON.parse(configElement.textContent);
  } catch (error) {
    return;
  }

  var endpoints = config.endpoints || {};
  var text = config.text || {};

  function setStatus(element, message, state) {
    if (!element) return;

    element.textContent = message;
    element.className = 'newsletter-status' + (state ? ' newsletter-status--' + state : '');
    element.hidden = !message;
  }

  function messageForFailure(status, code) {
    if (code === 'invalid_email') return text.invalidEmail;
    if (code === 'invalid_name') return text.invalidName || text.invalidEmail;
    if (code === 'invalid_phone') return text.invalidPhone || text.invalidEmail;
    if (code === 'rate_limited') return text.rateLimited;
    if (code === 'not_configured' || status === 503) return text.unavailable;

    return text.error;
  }

  function submitEmail(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response
        .json()
        .catch(function () { return {}; })
        .then(function (body) { return { status: response.status, body: body }; });
    });
  }

  function track(name, params) {
    if (window.Analytics) Analytics.track(name, params);
  }

  function bindForm(form, options) {
    var status = form.querySelector('[data-newsletter-status]');
    var button = form.querySelector('button[type="submit"]');
    var emailInput = form.querySelector('input[type="email"]');
    var nameInput = form.querySelector('[data-newsletter-name]');
    var phoneInput = form.querySelector('[data-newsletter-phone]');
    var waitlistFields = form.querySelector('[data-newsletter-waitlist-fields]');
    var honeypot = form.querySelector('[data-newsletter-honeypot]');
    var busy = false;

    function currentSource() {
      return form.getAttribute('data-newsletter-source') || options.source || 'website';
    }

    // Set when the panel was opened from a waitlist button, so the signup is
    // still a newsletter subscriber but the backoffice knows which list.
    function currentWaitlist() {
      var kind = form.getAttribute('data-newsletter-waitlist-kind') || '';
      var slug = form.getAttribute('data-newsletter-waitlist-slug') || '';
      var title = form.getAttribute('data-newsletter-waitlist-title') || '';
      if (!kind && !slug && !title) return null;
      return { kind: kind || 'general', slug: slug || '', title: title || '' };
    }

    /* A waitlist signup has to leave Bina a way to reach the person: name and
       phone are shown and required only while the form carries a waitlist. */
    function syncWaitlistFields() {
      var active = Boolean(currentWaitlist());
      if (waitlistFields) waitlistFields.hidden = !active;
      if (nameInput) nameInput.required = active;
      if (phoneInput) phoneInput.required = active;
    }

    /* Mirrors normalizePhone in lib/newsletter/subscribers.mjs: Israeli
       mobile (05…) or landline (02/03/04/08/09…), in local form. */
    function validPhone(value) {
      var digits = String(value || '').replace(/[^0-9]/g, '');
      if (digits.indexOf('972') === 0) digits = '0' + digits.slice(3);
      if (digits.charAt(0) !== '0') digits = '0' + digits;
      return /^0[2-489][0-9]{7}$/.test(digits) || /^05[0-9]{8}$/.test(digits);
    }

    /* A waitlist name must be callable: first name and family name. */
    function validName(value) {
      var words = String(value || '')
        .trim()
        .split(/\s+/)
        .filter(function (word) {
          return word.replace(/[^A-Za-z֐-׿]/g, '').length >= 2;
        });
      return words.length >= 2;
    }

    syncWaitlistFields();
    form.addEventListener('newsletter-waitlist-change', syncWaitlistFields);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy || !emailInput) return;

      var email = emailInput.value.trim();
      var source = currentSource();
      var waitlist = currentWaitlist();
      var personName = nameInput ? nameInput.value.trim() : '';
      var phone = phoneInput ? phoneInput.value.trim() : '';

      if (waitlist) {
        if (!validName(personName)) {
          setStatus(status, text.invalidName || text.invalidEmail, 'error');
          if (nameInput) { try { nameInput.focus(); } catch (e) { /* ignore */ } }
          return;
        }
        if (!validPhone(phone)) {
          setStatus(status, text.invalidPhone || text.invalidEmail, 'error');
          if (phoneInput) { try { phoneInput.focus(); } catch (e) { /* ignore */ } }
          return;
        }
      }

      if (!email) {
        setStatus(status, text.invalidEmail, 'error');
        if (options.trackName) {
          track(options.trackName + '_error', {
            reason: 'invalid_email',
            source: source || undefined,
          });
        }
        return;
      }

      busy = true;
      var idleLabel = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = options.busyLabel;
      }
      setStatus(status, '', null);

      var payload = { email: email };
      if (honeypot) payload.website = honeypot.value;
      if (source) payload.source = source;
      if (waitlist) payload.waitlist = waitlist;
      if (waitlist && personName) payload.name = personName;
      if (waitlist && phone) payload.phone = phone;

      submitEmail(options.url, payload)
        .then(function (result) {
          if (result.body && result.body.ok) {
            setStatus(status, options.successMessage(result.body, email), 'success');
            form.reset();
            if (options.trackName) {
              track(options.trackName, { source: source || undefined });
            }
            return;
          }

          setStatus(status, messageForFailure(result.status, result.body && result.body.code), 'error');
          if (options.trackName) {
            track(options.trackName + '_error', {
              reason: (result.body && result.body.code) || 'request_failed',
              source: source || undefined,
            });
          }
        })
        .catch(function () {
          setStatus(status, text.error, 'error');
          if (options.trackName) {
            track(options.trackName + '_error', {
              reason: 'network',
              source: source || undefined,
            });
          }
        })
        .then(function () {
          busy = false;
          if (button) {
            button.disabled = false;
            button.textContent = idleLabel;
          }
        });
    });
  }

  function initSignupForms() {
    if (!endpoints.subscribe) return;

    Array.prototype.forEach.call(document.querySelectorAll('[data-newsletter-form]'), function (form) {
      bindForm(form, {
        url: endpoints.subscribe,
        busyLabel: text.sending,
        source: form.getAttribute('data-newsletter-source') || 'website',
        trackName: 'newsletter_signup',
        successMessage: function () { return text.success; }
      });
    });
  }

  function initUnsubscribeForms() {
    if (!endpoints.unsubscribe) return;

    Array.prototype.forEach.call(document.querySelectorAll('[data-newsletter-unsubscribe-form]'), function (form) {
      bindForm(form, {
        url: endpoints.unsubscribe,
        busyLabel: text.sending,
        successMessage: function (body, submitted) {
          return removedMessage((body && body.email) || submitted);
        }
      });
    });
  }

  /* {email} is filled with the address that was just removed. A missing or
     odd value falls back to the generic wording, so a crafted query string
     cannot put arbitrary text in the banner. */
  function removedMessage(email) {
    var template = text.unsubscribed || '';
    var address = typeof email === 'string' ? email.trim() : '';
    if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(address) || address.length > 254) {
      address = 'הכתובת שלך';
    }
    return template.replace('{email}', address);
  }

  /* Someone who clicked the link in an issue footer is already removed by the
     time they land here; the redirect carries the address so the banner can
     name it. */
  function initUnsubscribeNotice() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('unsubscribed') !== '1') return;

    var form = document.querySelector('[data-newsletter-unsubscribe-form]');
    if (!form) return;

    setStatus(form.querySelector('[data-newsletter-status]'), removedMessage(params.get('email')), 'success');
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function initModal() {
    var modal = document.getElementById('newsletter-modal');
    if (!modal) return;

    var copy = config.modal || {};
    var intents = copy.intents || {};
    var titleEl = modal.querySelector('[data-newsletter-modal-title]');
    var descEl = modal.querySelector('[data-newsletter-modal-description]');
    var form = modal.querySelector('[data-newsletter-form]');
    var lastTrigger = null;

    function applyIntent(intent, source, trigger) {
      var pack = intents[intent] || {};
      if (titleEl) titleEl.textContent = pack.title || copy.title || '';
      if (descEl) descEl.textContent = pack.description || copy.description || '';
      if (form) {
        form.setAttribute('data-newsletter-source', source || intent || 'modal');
        ['kind', 'slug', 'title'].forEach(function (name) {
          var value = trigger && trigger.getAttribute('data-newsletter-waitlist-' + name);
          if (value) form.setAttribute('data-newsletter-waitlist-' + name, value);
          else form.removeAttribute('data-newsletter-waitlist-' + name);
        });
      }
      if (form) form.dispatchEvent(new CustomEvent('newsletter-waitlist-change'));
      var status = form && form.querySelector('[data-newsletter-status]');
      setStatus(status, '', null);
    }

    function openModal(trigger) {
      lastTrigger = trigger || null;
      var intent = (trigger && trigger.getAttribute('data-newsletter-intent')) || '';
      var source = (trigger && trigger.getAttribute('data-newsletter-source')) || 'modal';
      applyIntent(intent, source, trigger);
      modal.hidden = false;
      document.body.classList.add('newsletter-modal-open');
      var email = form && form.querySelector('input[type="email"]');
      if (email) {
        try { email.focus(); } catch (e) { /* ignore */ }
      }
    }

    function closeModal() {
      if (modal.hidden) return;
      modal.hidden = true;
      document.body.classList.remove('newsletter-modal-open');
      if (lastTrigger && typeof lastTrigger.focus === 'function') {
        try { lastTrigger.focus(); } catch (e) { /* ignore */ }
      }
      lastTrigger = null;
    }

    document.addEventListener('click', function (event) {
      var trigger = event.target.closest && event.target.closest('[data-newsletter-open]');
      if (trigger) {
        event.preventDefault();
        openModal(trigger);
        return;
      }
      if (event.target.closest && event.target.closest('[data-newsletter-close]')) {
        event.preventDefault();
        closeModal();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeModal();
    });
  }

  function init() {
    initSignupForms();
    initUnsubscribeForms();
    initUnsubscribeNotice();
    initModal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
