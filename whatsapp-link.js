// Route WhatsApp links by device: the app on phones/tablets, WhatsApp Web on desktop.
// Links keep a plain https://wa.me/ href as a fallback if this script doesn't run.
(function () {
  var ua = navigator.userAgent || '';
  var mq = function (q) { return window.matchMedia && window.matchMedia(q).matches; };
  var isMobile = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || // iPadOS
    // Phones in "desktop site" mode report a desktop user agent, but their
    // primary input is still a touchscreen with no hover (unlike laptops).
    (navigator.maxTouchPoints > 0 && mq('(pointer: coarse)') && mq('(hover: none)'));

  document.querySelectorAll('a[data-whatsapp]').forEach(function (link) {
    var phone = link.getAttribute('data-whatsapp');
    var fallback = link.href;

    if (!isMobile) {
      link.href = 'https://web.whatsapp.com/send?phone=' + phone;
      return;
    }

    link.href = 'whatsapp://send?phone=' + phone;
    link.removeAttribute('target');
    link.addEventListener('click', function () {
      // If the app isn't installed the page stays visible; fall back to wa.me.
      var timer = setTimeout(function () {
        if (!document.hidden) window.location.href = fallback;
      }, 1500);
      var cancel = function () { clearTimeout(timer); };
      window.addEventListener('pagehide', cancel, { once: true });
      window.addEventListener('blur', cancel, { once: true });
      document.addEventListener('visibilitychange', cancel, { once: true });
    });
  });
})();
