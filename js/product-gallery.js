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
    var gallery = thumb.closest('[data-product-gallery]');
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

  document.addEventListener('click', function (event) {
    var nav = event.target.closest('[data-gallery-prev], [data-gallery-next]');
    if (nav) {
      var gallery = nav.closest('[data-product-gallery]');
      if (!gallery) return;
      event.preventDefault();
      var step = nav.hasAttribute('data-gallery-next') ? 1 : -1;
      activateIndex(gallery, activeIndex(gallery) + step);
      return;
    }

    var thumb = event.target.closest('.product-gallery__thumb');
    if (!thumb) return;
    event.preventDefault();
    activateThumb(thumb);
  });

  document.addEventListener('mouseover', function (event) {
    if (!canHoverPreview()) return;
    var thumb = event.target.closest('.product-gallery__thumb');
    if (!thumb) return;
    activateThumb(thumb);
  });

  document.addEventListener('keydown', function (event) {
    var thumb = event.target.closest('.product-gallery__thumb');
    if (thumb) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activateThumb(thumb);
      return;
    }

    var nav = event.target.closest('[data-gallery-prev], [data-gallery-next]');
    if (!nav) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var gallery = nav.closest('[data-product-gallery]');
    if (!gallery) return;
    event.preventDefault();
    var step = nav.hasAttribute('data-gallery-next') ? 1 : -1;
    activateIndex(gallery, activeIndex(gallery) + step);
  });
})();
