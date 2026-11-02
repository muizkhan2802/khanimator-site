/* ==========================================================================
   Notification bell.

   Shared by the pitch board and the moderator dashboard. Mount it with
   KhanNotify.mount(supabaseClient, user, containerElement) and call
   KhanNotify.unmount() on sign-out.

   Nothing here can create a notification — the notifications table has no
   INSERT policy at all, and rows are written only by database triggers. This
   file reads your own inbox and marks it read, which is all the policies let
   anyone do.
   ========================================================================== */

(function () {
  'use strict';

  var sb = null;
  var me = null;
  var host = null;
  var poll = null;
  var open = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ago(iso) {
    var s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + 'm';
    var h = Math.floor(m / 60); if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }

  var ICON = {
    reply: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l2-5a8.4 8.4 0 0 1 16-4.5z',
    pitch_status: 'M20 6 9 17l-5-5',
    new_pitch: 'M12 5v14M5 12h14'
  };

  function render(rows, unread) {
    host.textContent = '';

    var wrap = el('div', 'bell-wrap');

    var btn = el('button', 'bell');
    btn.setAttribute('aria-label',
      unread ? unread + ' unread notifications' : 'Notifications');
    btn.setAttribute('aria-expanded', String(open));
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
      '<path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
    if (unread > 0) btn.appendChild(el('span', 'bell__dot', unread > 9 ? '9+' : String(unread)));
    wrap.appendChild(btn);

    var panel = el('div', 'bell-panel');
    panel.hidden = !open;

    var head = el('div', 'bell-panel__head');
    head.appendChild(el('span', null, 'Notifications'));
    if (unread > 0) {
      var clear = el('button', 'bell-panel__clear', 'Mark all read');
      clear.addEventListener('click', function () {
        sb.rpc('mark_all_read').then(refresh);
      });
      head.appendChild(clear);
    }
    panel.appendChild(head);

    if (!rows.length) {
      panel.appendChild(el('p', 'bell-panel__empty', 'Nothing yet.'));
    } else {
      rows.forEach(function (n) {
        var item = el('a', 'bell-item' + (n.read_at ? '' : ' is-unread'));
        item.href = 'pitch.html';

        var ic = el('span', 'bell-item__icon');
        ic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ' +
          'aria-hidden="true"><path d="' + (ICON[n.kind] || ICON.reply) + '"/></svg>';
        item.appendChild(ic);

        var txt = el('span', 'bell-item__text');
        txt.appendChild(el('span', 'bell-item__title', n.title));
        if (n.body) txt.appendChild(el('span', 'bell-item__body', n.body));
        txt.appendChild(el('span', 'bell-item__at', ago(n.created_at) + ' ago'));
        item.appendChild(txt);

        panel.appendChild(item);
      });
    }

    wrap.appendChild(panel);
    host.appendChild(wrap);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      open = !open;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      // Opening the panel is the read receipt.
      if (open && unread > 0) {
        sb.rpc('mark_all_read').then(function () { refresh(true); });
      }
    });
  }

  /* Keep the panel open across a refresh triggered by marking read, so the
     list does not vanish from under the cursor. */
  function refresh(keepOpen) {
    if (!sb || !me || !host) return Promise.resolve();
    if (keepOpen === undefined) keepOpen = open;

    return sb.from('notifications')
      .select('id,kind,title,body,read_at,created_at')
      .order('created_at', { ascending: false })
      .limit(25)
      .then(function (res) {
        if (res.error) return;
        var rows = res.data || [];
        var unread = rows.filter(function (r) { return !r.read_at; }).length;
        open = keepOpen;
        render(rows, unread);
      });
  }

  function onDocClick() {
    if (!open) return;
    open = false;
    refresh(false);
  }

  var api = {
    mount: function (client, user, container) {
      sb = client; me = user; host = container;
      if (!sb || !me || !host) return;
      host.hidden = false;
      refresh();
      clearInterval(poll);
      poll = setInterval(function () { if (!open) refresh(); }, 45000);
      document.addEventListener('click', onDocClick);
    },

    unmount: function () {
      clearInterval(poll);
      document.removeEventListener('click', onDocClick);
      if (host) { host.textContent = ''; host.hidden = true; }
      sb = me = host = null;
      open = false;
    },

    refresh: function () { return refresh(); }
  };

  window.KhanNotify = api;
})();
