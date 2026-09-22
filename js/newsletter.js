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

  function bindForm(form, options) {
    var status = form.querySelector('[data-newsletter-status]');
    var button = form.querySelector('button[type="submit"]');
    var emailInput = form.querySelector('input[type="email"]');
    var honeypot = form.querySelector('[data-newsletter-honeypot]');
    var busy = false;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy || !emailInput) return;

      var email = emailInput.value.trim();
      if (!email) {
        setStatus(status, text.invalidEmail, 'error');
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
      if (options.source) payload.source = options.source;

      submitEmail(options.url, payload)
        .then(function (result) {
          if (result.body && result.body.ok) {
            setStatus(status, options.successMessage(result.body), 'success');
            form.reset();
            return;
          }

          setStatus(status, messageForFailure(result.status, result.body && result.body.code), 'error');
        })
        .catch(function () {
          setStatus(status, text.error, 'error');
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
        successMessage: function () { return text.unsubscribed; }
      });
    });
  }

  /* Someone who clicked the link in an issue footer is already removed by the
     time they land here; the redirect just needs to say so. */
  function initUnsubscribeNotice() {
    if (window.location.search.indexOf('unsubscribed=1') === -1) return;

    var form = document.querySelector('[data-newsletter-unsubscribe-form]');
    if (!form) return;

    setStatus(form.querySelector('[data-newsletter-status]'), text.unsubscribed, 'success');
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function init() {
    initSignupForms();
    initUnsubscribeForms();
    initUnsubscribeNotice();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
