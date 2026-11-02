/* ==========================================================================
   Moderator dashboard.

   Hiding the UI is a convenience, not a safeguard — the real gate is RLS. An
   ordinary signed-in user who opens this page gets empty queries and a
   refused board_stats() call, because the policies in schema.sql and
   admin.sql do not let them read pending pitches or the audit log.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.getElementById('admin-app');
  if (!root) return;

  var CFG = window.KHANIMATOR_SUPABASE || {};
  var sb = null;
  var me = null;
  var isAdmin = false;
  var filter = 'pending';

  var STATUSES = ['pending', 'approved', 'building', 'done', 'rejected'];

  /* ------------------------------------------------------------ helpers -- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function show(id, on) {
    var n = document.getElementById(id);
    if (n) n.hidden = !on;
  }

  function say(msg, kind) {
    var box = document.getElementById('admin-status');
    box.textContent = msg || '';
    box.className = 'board-msg' + (kind ? ' board-msg--' + kind : '');
    box.hidden = !msg;
  }

  function when(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
           ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  /* -------------------------------------------------------------- gates -- */

  function renderGate() {
    var bar = document.getElementById('admin-who');
    bar.textContent = '';

    if (!sb) {
      bar.appendChild(el('span', 'board-auth__note',
        'Not connected to the database yet.'));
      return;
    }
    if (!me) {
      bar.appendChild(el('span', 'board-auth__note', 'Sign in to continue.'));
      var b = el('button', 'btn btn--primary btn--sm', 'Sign in with Google');
      b.addEventListener('click', function () {
        sb.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin + '/admin.html' }
        });
      });
      bar.appendChild(b);
      return;
    }

    var who = el('span', 'board-auth__who');
    who.appendChild(el('b', null, me.email));
    if (isAdmin) who.appendChild(el('span', 'board-auth__badge', 'moderator'));
    bar.appendChild(who);

    var side = el('span', 'board-auth__side');

    var mount = el('span', 'bell-mount');
    side.appendChild(mount);

    var back = el('a', 'btn btn--ghost btn--sm', 'Board');
    back.href = '/pitch.html';
    side.appendChild(back);

    var out = el('button', 'btn btn--ghost btn--sm', 'Sign out');
    out.addEventListener('click', function () {
      if (window.KhanNotify) window.KhanNotify.unmount();
      sb.auth.signOut();
    });
    side.appendChild(out);
    bar.appendChild(side);

    if (window.KhanNotify) window.KhanNotify.mount(sb, me, mount);
  }

  /* -------------------------------------------------------------- stats -- */

  function loadStats() {
    return sb.rpc('board_stats').then(function (res) {
      var box = document.getElementById('admin-stats');
      box.textContent = '';
      if (res.error || !res.data) return;

      var d = res.data;
      [['Pending', d.pending, 'warn'], ['Approved', d.approved], ['In production', d.building],
       ['Animated', d.done], ['Rejected', d.rejected], ['Replies', d.replies],
       ['Votes', d.votes], ['People', d.people]
      ].forEach(function (row) {
        var t = el('div', 'stat');
        var n = el('div', 'stat__num', String(row[1]));
        if (row[2] === 'warn' && row[1] > 0) n.style.color = 'var(--blood)';
        t.appendChild(n);
        t.appendChild(el('div', 'stat__label', row[0]));
        box.appendChild(t);
      });
    });
  }

  /* ------------------------------------------------------------ pitches -- */

  function statusButton(p, next, label, kind) {
    var b = el('button', 'btn btn--sm ' + (kind === 'primary' ? 'btn--primary' : 'btn--ghost'), label);
    b.addEventListener('click', function () {
      b.disabled = true;
      sb.from('pitches').update({ status: next }).eq('id', p.id).then(function (res) {
        b.disabled = false;
        if (res.error) { say('Could not update: ' + res.error.message, 'bad'); return; }
        say('"' + p.body.slice(0, 40) + '…" → ' + next, 'good');
        refresh();
      });
    });
    return b;
  }

  function renderQueue(rows) {
    var list = document.getElementById('admin-queue');
    list.textContent = '';

    if (!rows.length) {
      var e = el('div', 'board-empty');
      e.appendChild(el('h3', null, filter === 'pending' ? 'Nothing waiting' : 'Nothing here'));
      e.appendChild(el('p', null, filter === 'pending'
        ? 'The queue is clear. Every pitch has been dealt with.'
        : 'No pitches with that status.'));
      list.appendChild(e);
      return;
    }

    rows.forEach(function (p) {
      var card = el('article', 'modrow');

      var main = el('div');
      main.appendChild(el('p', 'modrow__text', p.body));
      main.appendChild(el('div', 'modrow__meta',
        p.display_name + ' · ' + when(p.created_at) + ' · ' + p.status));
      card.appendChild(main);

      var acts = el('div', 'modrow__acts');
      if (p.status === 'pending') {
        acts.appendChild(statusButton(p, 'approved', 'Approve', 'primary'));
        acts.appendChild(statusButton(p, 'rejected', 'Reject'));
      } else if (p.status === 'approved') {
        acts.appendChild(statusButton(p, 'building', 'Mark in production', 'primary'));
        acts.appendChild(statusButton(p, 'rejected', 'Take down'));
      } else if (p.status === 'building') {
        acts.appendChild(statusButton(p, 'done', 'Mark animated', 'primary'));
        acts.appendChild(statusButton(p, 'approved', 'Back to board'));
      } else {
        acts.appendChild(statusButton(p, 'approved', 'Put on the board', 'primary'));
      }

      var del = el('button', 'btn btn--sm btn--ghost', 'Delete');
      del.addEventListener('click', function () {
        if (!window.confirm('Delete this pitch permanently?\n\n"' + p.body + '"')) return;
        sb.from('pitches').delete().eq('id', p.id).then(function (res) {
          if (res.error) { say('Could not delete: ' + res.error.message, 'bad'); return; }
          say('Deleted.', 'good');
          refresh();
        });
      });
      acts.appendChild(del);

      card.appendChild(acts);
      list.appendChild(card);
    });
  }

  function loadQueue() {
    var q = sb.from('pitches')
      .select('id,body,display_name,status,created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (filter !== 'all') q = q.eq('status', filter);

    return q.then(function (res) {
      if (res.error) { say('Could not load pitches: ' + res.error.message, 'bad'); return; }
      renderQueue(res.data || []);
    });
  }

  function wireFilters() {
    var bar = document.getElementById('admin-filters');
    bar.textContent = '';
    ['pending'].concat(STATUSES.filter(function (s) { return s !== 'pending'; }))
      .concat(['all'])
      .forEach(function (s) {
        var b = el('button', 'subnav__link' + (s === filter ? ' is-active' : ''),
                   s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1));
        b.addEventListener('click', function () { filter = s; wireFilters(); loadQueue(); });
        bar.appendChild(b);
      });
  }

  /* ---------------------------------------------------------- audit log -- */

  function loadLog() {
    return sb.from('audit_log')
      .select('at,actor_email,action,target_type,detail')
      .order('at', { ascending: false })
      .limit(60)
      .then(function (res) {
        var box = document.getElementById('admin-log');
        box.textContent = '';

        if (res.error) {
          box.appendChild(el('p', 'thread__loading', 'Could not load the log.'));
          return;
        }
        if (!(res.data || []).length) {
          box.appendChild(el('p', 'thread__loading', 'Nothing logged yet.'));
          return;
        }

        res.data.forEach(function (r) {
          var row = el('div', 'logrow');
          row.appendChild(el('span', 'logrow__at', when(r.at)));
          row.appendChild(el('span', 'logrow__who', r.actor_email || '—'));
          row.appendChild(el('span', 'logrow__what', r.action));
          row.appendChild(el('span', 'logrow__detail', r.detail || ''));
          box.appendChild(row);
        });
      });
  }

  /* ----------------------------------------------------------- lifecycle -- */

  function refresh() {
    if (!isAdmin) return Promise.resolve();
    return Promise.all([loadStats(), loadQueue(), loadLog()]);
  }

  function afterAuth() {
    return sb.rpc('is_admin').then(function (res) {
      isAdmin = res.data === true;
    }).catch(function () {
      isAdmin = false;
    }).then(function () {
      renderGate();
      show('admin-signedout', !me);
      show('admin-denied', !!me && !isAdmin);
      show('admin-panel', isAdmin);
      if (me) sb.rpc('record_sign_in');
      return refresh();
    });
  }

  function boot() {
    if (!CFG.url || !CFG.anonKey) {
      renderGate();
      say('The dashboard is not connected to its database yet. See supabase/SETUP.md.', 'bad');
      return;
    }
    if (!window.supabase) {
      say('Could not reach the board service. Reload in a moment.', 'bad');
      return;
    }

    sb = window.supabase.createClient(CFG.url, CFG.anonKey);
    wireFilters();

    sb.auth.getSession().then(function (res) {
      me = (res.data && res.data.session && res.data.session.user) || null;
      afterAuth();
    });

    sb.auth.onAuthStateChange(function (_e, session) {
      me = (session && session.user) || null;
      afterAuth();
    });
  }

  boot();
})();
