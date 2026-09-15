/* Newsletter signup, self-serve unsubscribe, and the latest-issue teaser. */
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
  var dateFormatter = null;

  function formatDate(isoDate) {
    if (!isoDate) return '';

    var date = new Date(isoDate);
    if (isNaN(date.getTime())) return '';

    if (!dateFormatter) {
      try {
        dateFormatter = new Intl.DateTimeFormat(config.locale || 'he-IL', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });
      } catch (error) {
        dateFormatter = { format: function (value) { return value.toLocaleDateString(); } };
      }
    }

    return dateFormatter.format(date);
  }

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
        successMessage: function (body) {
          return body.status === 'pending' ? text.confirmPending : text.success;
        }
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

  function buildTeaserCard(post) {
    var card = document.createElement('a');
    card.className = 'newsletter-teaser__card';
    card.href = post.url;
    card.target = '_blank';
    card.rel = 'noopener';

    if (post.thumbnail) {
      var figure = document.createElement('div');
      figure.className = 'newsletter-teaser__media';

      var image = document.createElement('img');
      image.src = post.thumbnail;
      image.alt = post.title || '';
      image.loading = 'lazy';

      figure.appendChild(image);
      card.appendChild(figure);
    }

    var body = document.createElement('div');
    body.className = 'newsletter-teaser__body';

    var publishedAt = formatDate(post.publishedAt);
    if (publishedAt) {
      var date = document.createElement('p');
      date.className = 'newsletter-teaser__date';
      date.textContent = publishedAt;
      body.appendChild(date);
    }

    var title = document.createElement('h4');
    title.className = 'newsletter-teaser__title';
    title.textContent = post.title || text.untitledIssue;
    body.appendChild(title);

    var excerpt = post.subtitle || post.previewText;
    if (excerpt) {
      var paragraph = document.createElement('p');
      paragraph.className = 'newsletter-teaser__excerpt';
      paragraph.textContent = excerpt;
      body.appendChild(paragraph);
    }

    var cta = document.createElement('span');
    cta.className = 'newsletter-teaser__cta';
    cta.textContent = text.readIssue;
    body.appendChild(cta);

    card.appendChild(body);
    return card;
  }

  function initLatestIssues() {
    var containers = document.querySelectorAll('[data-newsletter-latest]');
    if (!containers.length || !endpoints.latest) return;

    Array.prototype.forEach.call(containers, function (container) {
      var limit = parseInt(container.getAttribute('data-newsletter-limit'), 10) || 1;
      var target = container.querySelector('[data-newsletter-latest-target]') || container;

      fetch(endpoints.latest + '?limit=' + limit, { headers: { Accept: 'application/json' } })
        .then(function (response) { return response.json(); })
        .then(function (body) {
          var posts = (body && body.posts) || [];
          // Nothing published yet: leave the section hidden instead of
          // advertising an empty archive.
          if (!posts.length) return;

          target.innerHTML = '';
          posts.forEach(function (post) { target.appendChild(buildTeaserCard(post)); });
          container.hidden = false;
        })
        .catch(function () { /* the section stays hidden */ });
    });
  }

  function init() {
    initSignupForms();
    initUnsubscribeForms();
    initLatestIssues();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
