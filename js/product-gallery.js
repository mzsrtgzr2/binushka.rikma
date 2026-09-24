(function () {
  function canHoverPreview() {
    return window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  function setActiveThumb(gallery, thumb) {
    gallery.querySelectorAll('.product-gallery__thumb').forEach(function (el) {
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

  document.addEventListener('click', function (event) {
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
    if (!thumb) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activateThumb(thumb);
  });
})();
