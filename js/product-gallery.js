(function () {
  function canHoverPreview() {
    return window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  function thumbsOf(gallery) {
    return Array.prototype.slice.call(gallery.querySelectorAll('.product-gallery__thumb'));
  }

  function setActiveThumb(gallery, thumb) {
    thumbsOf(gallery).forEach(function (el) {
      var on = el === thumb;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function showImage(gallery, src) {
    if (!gallery || !src) return;
    var main = gallery.querySelector('[data-gallery-main]');
    if (!main) return;
    if (main.getAttribute('src') === src || main.getAttribute('data-src') === src) {
      if (!main.getAttribute('src')) {
        main.setAttribute('src', src);
        main.classList.add('loaded');
      }
      return;
    }
    main.setAttribute('data-src', src);
    main.setAttribute('src', src);
    main.classList.add('loaded');
  }

  function activateThumb(thumb) {
    if (!thumb) return;
    var gallery = closest(thumb, '[data-product-gallery]');
    var src = thumb.getAttribute('data-gallery-src');
    if (!gallery || !src) return;
    setActiveThumb(gallery, thumb);
    showImage(gallery, src);
  }

  function activateIndex(gallery, index) {
    var thumbs = thumbsOf(gallery);
    if (!thumbs.length) return;
    var i = ((index % thumbs.length) + thumbs.length) % thumbs.length;
    activateThumb(thumbs[i]);
  }

  function activeIndex(gallery) {
    var thumbs = thumbsOf(gallery);
    for (var i = 0; i < thumbs.length; i++) {
      if (thumbs[i].classList.contains('is-active')) return i;
    }
    return 0;
  }

  // mouseover on the homepage can target a text node. Those nodes have no
  // closest(), and some in-app browsers keep the previous file cached, so
  // this walk never calls closest at all.
  function closest(node, selector) {
    var guard = 0;
    try {
      while (node && guard < 40) {
        guard += 1;
        if (node.nodeType === 1) {
          var fn = node.matches || node.webkitMatchesSelector || node.msMatchesSelector;
          if (typeof fn === 'function' && fn.call(node, selector)) return node;
        }
        var next = node.parentElement || node.parentNode;
        if (!next || next === node) break;
        node = next;
      }
    } catch (ignore) {}
    return null;
  }

  document.addEventListener('click', function (event) {
    var nav = closest(event && event.target, '[data-gallery-prev], [data-gallery-next]');
    if (nav) {
      var gallery = closest(nav, '[data-product-gallery]');
      if (!gallery) return;
      event.preventDefault();
      var step = nav.hasAttribute('data-gallery-next') ? 1 : -1;
      activateIndex(gallery, activeIndex(gallery) + step);
      return;
    }

    var thumb = closest(event && event.target, '.product-gallery__thumb');
    if (!thumb) return;
    event.preventDefault();
    activateThumb(thumb);
  });

  document.addEventListener('mouseover', function (event) {
    if (!canHoverPreview()) return;
    var thumb = closest(event && event.target, '.product-gallery__thumb');
    if (!thumb) return;
    activateThumb(thumb);
  });

  document.addEventListener('keydown', function (event) {
    var thumb = closest(event && event.target, '.product-gallery__thumb');
    if (thumb) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activateThumb(thumb);
      return;
    }

    var nav = closest(event && event.target, '[data-gallery-prev], [data-gallery-next]');
    if (!nav) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var gallery = closest(nav, '[data-product-gallery]');
    if (!gallery) return;
    event.preventDefault();
    var step = nav.hasAttribute('data-gallery-next') ? 1 : -1;
    activateIndex(gallery, activeIndex(gallery) + step);
  });
})();
