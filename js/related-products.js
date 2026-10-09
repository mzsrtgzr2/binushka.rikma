(function () {
  function closest(el, selector) {
    while (el && el.nodeType === 1) {
      if (el.matches && el.matches(selector)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function isRtl(el) {
    return getComputedStyle(el).direction === 'rtl';
  }

  function slidesOf(track) {
    return Array.prototype.slice.call(track.querySelectorAll('.related-products__slide'));
  }

  function slideStep(track) {
    var slide = track.querySelector('.related-products__slide');
    if (!slide) return Math.max(track.clientWidth * 0.8, 200);
    var styles = getComputedStyle(track);
    var gap = parseFloat(styles.columnGap || styles.gap) || 0;
    return slide.getBoundingClientRect().width + gap;
  }

  function edgeState(track) {
    var slides = slidesOf(track);
    var canScroll = track.scrollWidth > track.clientWidth + 4;
    if (!canScroll || !slides.length) {
      return { canScroll: false, atStart: true, atEnd: true };
    }

    var trackRect = track.getBoundingClientRect();
    var first = slides[0].getBoundingClientRect();
    var last = slides[slides.length - 1].getBoundingClientRect();
    var rtl = isRtl(track);
    var startGap = rtl ? trackRect.right - first.right : first.left - trackRect.left;
    var endGap = rtl ? last.left - trackRect.left : trackRect.right - last.right;

    return {
      canScroll: true,
      atStart: startGap >= -4,
      atEnd: endGap >= -4
    };
  }

  function updateNav(carousel) {
    var track = carousel.querySelector('[data-related-track]');
    var prev = carousel.querySelector('[data-related-prev]');
    var next = carousel.querySelector('[data-related-next]');
    if (!track || !prev || !next) return;

    var state = edgeState(track);
    carousel.classList.toggle('is-scrollable', state.canScroll);
    prev.disabled = !state.canScroll || state.atStart;
    next.disabled = !state.canScroll || state.atEnd;
  }

  function scrollByDir(track, towardEnd) {
    var step = slideStep(track);
    var delta = towardEnd ? step : -step;
    // Positive scrollLeft moves content left. In RTL reading order, "next"
    // reveals items further to the left, so the visual delta flips.
    if (isRtl(track)) delta = -delta;
    track.scrollBy({ left: delta, behavior: 'smooth' });
  }

  function initCarousel(carousel) {
    var track = carousel.querySelector('[data-related-track]');
    if (!track) return;

    updateNav(carousel);

    track.addEventListener('scroll', function () {
      updateNav(carousel);
    }, { passive: true });

    window.addEventListener('resize', function () {
      updateNav(carousel);
    });
  }

  document.addEventListener('click', function (event) {
    var prev = closest(event.target, '[data-related-prev]');
    var next = closest(event.target, '[data-related-next]');
    var nav = prev || next;
    if (!nav || nav.disabled) return;

    var carousel = closest(nav, '[data-related-carousel]');
    if (!carousel) return;
    var track = carousel.querySelector('[data-related-track]');
    if (!track) return;

    scrollByDir(track, !!next);
  });

  document.querySelectorAll('[data-related-carousel]').forEach(initCarousel);
})();
