/* ==========================================================================
   Khanimator - site behaviour
   Vanilla JS, no dependencies. Everything degrades gracefully without it.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------ mobile nav -- */

  var nav = document.querySelector('.nav');
  var toggle = document.querySelector('.nav__toggle');

  if (nav && toggle) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    });

    // Close the menu when a link is tapped or Escape is pressed.
    nav.querySelectorAll('.nav__links a').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
        toggle.focus();
      }
    });
  }

  /* --------------------------------------------- sticky nav shadow -- */

  if (nav) {
    var onScroll = function () {
      nav.classList.toggle('is-stuck', window.scrollY > 12);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* -------------------------------------------------- lazy YouTube -- */
  /* Thumbnail first; the real iframe is only injected on click, so the
     page never loads YouTube's player (or its cookies) unasked.        */

  document.querySelectorAll('.player[data-yt]').forEach(function (player) {
    player.addEventListener('click', function () {
      if (player.classList.contains('is-playing')) return;

      var id = player.getAttribute('data-yt');
      var frame = document.createElement('iframe');

      frame.src = 'https://www.youtube-nocookie.com/embed/' + id +
                  '?autoplay=1&rel=0&modestbranding=1';
      frame.title = player.getAttribute('data-title') || 'Video player';
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; ' +
                    'gyroscope; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      frame.setAttribute('loading', 'lazy');

      player.appendChild(frame);
      player.classList.add('is-playing');
    });
  });

  /* Fall back to the standard-res thumbnail when maxres is missing.
     Two cases to catch: a genuine load error, and — the common one — YouTube
     answering 200 with a 120x90 grey placeholder, which fires `load`, not
     `error`. Older uploads hit the second case constantly. */

  function downgradeThumb(img) {
    if (img.dataset.thumbFallback) return;      // only ever try once
    img.dataset.thumbFallback = '1';
    img.src = img.src.replace('maxresdefault', 'hqdefault');
  }

  document.querySelectorAll('.player img').forEach(function (img) {
    img.addEventListener('error', function () { downgradeThumb(img); });

    img.addEventListener('load', function () {
      if (img.naturalWidth <= 120) downgradeThumb(img);
    });

    // Images already decoded from cache never fire `load` for a late listener.
    if (img.complete && img.naturalWidth > 0 && img.naturalWidth <= 120) {
      downgradeThumb(img);
    }
  });

  /* ------------------------------------------------- scroll reveal -- */

  var revealables = document.querySelectorAll('[data-reveal]');

  if (!('IntersectionObserver' in window)) {
    revealables.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var delay = parseInt(entry.target.getAttribute('data-reveal-delay') || '0', 10);
        setTimeout(function () { entry.target.classList.add('is-in'); }, delay);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

    revealables.forEach(function (el) { observer.observe(el); });
  }

  /* ------------------------------------------------- count-up stats -- */

  var counters = document.querySelectorAll('[data-count]');

  if (counters.length && 'IntersectionObserver' in window &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {

    var countObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;

        var el     = entry.target;
        var target = parseFloat(el.getAttribute('data-count'));
        var suffix = el.getAttribute('data-suffix') || '';
        var decs   = parseInt(el.getAttribute('data-decimals') || '0', 10);
        var start  = performance.now();
        var DUR    = 1500;

        var tick = function (now) {
          var p = Math.min((now - start) / DUR, 1);
          var eased = 1 - Math.pow(1 - p, 3);          // easeOutCubic
          el.textContent = (target * eased).toFixed(decs) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
        countObserver.unobserve(el);
      });
    }, { threshold: 0.5 });

    counters.forEach(function (el) { countObserver.observe(el); });
  }

  /* --------------------------------------------------- contact form -- */
  /* The form posts to Netlify Forms, which only exists once deployed. On a
     local server that POST 404s, so intercept it here and say so instead of
     showing the visitor a broken page. On the real host this does nothing. */

  var isLocal = ['localhost', '127.0.0.1', ''].indexOf(location.hostname) !== -1;
  var form = document.querySelector('form[data-netlify]');

  if (form && isLocal) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = form.querySelector('[data-form-status]');
      if (note) {
        note.textContent =
          'Running locally — Netlify Forms only works on the deployed site. ' +
          'Submissions will go through once this is live.';
        note.style.color = 'var(--accent)';
      }
    });
  }

  /* ---------------------------------------------------- footer year -- */

  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
})();
