// Light / dark theme: remembers the choice, otherwise follows the device setting.
(function () {
  var KEY = 'smg-theme';
  var t = null;
  try { t = localStorage.getItem(KEY); } catch (e) {}
  if (t !== 'dark' && t !== 'light') t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);

  function paint() {
    var cur = document.documentElement.getAttribute('data-theme');
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.textContent = cur === 'dark' ? '☀️' : '🌙';
      b.setAttribute('title', cur === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      b.setAttribute('aria-label', b.getAttribute('title'));
    });
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('[data-theme-toggle]')) return;
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (er) {}
    paint();
  });
  document.addEventListener('DOMContentLoaded', paint);
})();
