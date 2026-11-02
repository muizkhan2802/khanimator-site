/* ==========================================================================
   Khanimator pitch board — the live half.

   Talks straight to Supabase from the browser. There is no server of ours in
   the middle, so nothing here is a security control: every rule that matters
   (one vote per person, pitches start pending, only admins approve) lives in
   the RLS policies in supabase/schema.sql. This file is allowed to be
   optimistic; the database is the one being strict.

   Degrades on purpose: with no config, or if Supabase is unreachable, the
   page still renders and says so rather than showing dead buttons.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.getElementById('board-app');
  if (!root) return;

  var CFG = window.KHANIMATOR_SUPABASE || {};
  var MAX_PITCH = 100;
  var MAX_REPLY = 300;

  var sb = null;
  var me = null;          // current auth user, or null
  var isAdmin = false;
  var myVotes = {};       // pitch id -> -1 | 1
  var openReplies = {};   // pitch id -> true when the thread is expanded

  /* ------------------------------------------------------------ helpers -- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // textContent: never innerHTML
    return n;
  }

  function status(msg, kind) {
    var box = document.getElementById('board-status');
    if (!box) return;
    box.textContent = msg || '';
    box.className = 'board-msg' + (kind ? ' board-msg--' + kind : '');
    box.hidden = !msg;
  }

  function ago(iso) {
    var s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60);     if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);     if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24);     if (d < 30) return d + 'd ago';
    return new Date(iso).toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* Supabase surfaces our trigger messages verbatim; show those, and a plain
     sentence for anything else rather than a raw Postgres error. */
  function explain(error) {
    if (!error) return 'Something went wrong.';
    var m = error.message || '';
    if (/pitches a day/i.test(m) || /Slow down/i.test(m)) return m;
    if (/duplicate key/i.test(m)) return 'You have already voted on that one.';
    if (/row-level security/i.test(m)) return 'You need to be signed in for that.';
    return 'That did not go through. Try again in a moment.';
  }

  /* -------------------------------------------------------------- render -- */

  function renderAuth() {
    var bar = document.getElementById('board-auth');
    bar.textContent = '';

    if (!sb) {
      bar.appendChild(el('span', 'board-auth__note',
        'Sign-in is not connected yet, so the board is read-only.'));
      return;
    }

    if (me) {
      var who = el('span', 'board-auth__who');
      who.appendChild(el('b', null, me.user_metadata.full_name || me.email));
      if (isAdmin) who.appendChild(el('span', 'board-auth__badge', 'moderator'));
      bar.appendChild(who);

      var out = el('button', 'btn btn--ghost btn--sm', 'Sign out');
      out.addEventListener('click', function () { sb.auth.signOut(); });
      bar.appendChild(out);
    } else {
      bar.appendChild(el('span', 'board-auth__note',
        'Sign in to pitch, vote and reply. One account, one vote.'));
      var inBtn = el('button', 'btn btn--primary btn--sm', 'Sign in with Google');
      inBtn.addEventListener('click', signIn);
      bar.appendChild(inBtn);
    }
  }

  function voteButton(pitch, dir) {
    var mine = myVotes[pitch.id];
    var active = mine === dir;
    var b = el('button', 'vote' + (active ? ' is-on' : '') +
                         (dir === 1 ? ' vote--up' : ' vote--down'));
    b.setAttribute('aria-label', (dir === 1 ? 'Upvote' : 'Downvote') + ': ' + pitch.body);
    b.setAttribute('aria-pressed', String(active));
    b.innerHTML = dir === 1
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5l7 8h-4v6h-6v-6H5z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19l-7-8h4V5h6v6h4z"/></svg>';
    b.disabled = !me;
    if (!me) b.title = 'Sign in to vote';
    b.addEventListener('click', function () { castVote(pitch, dir); });
    return b;
  }

  function renderPitch(p) {
    var card = el('article', 'pitch');
    card.dataset.id = p.id;

    // score column
    var score = el('div', 'pitch__score');
    score.appendChild(voteButton(p, 1));
    var n = el('span', 'pitch__n', String(p.score));
    if (p.score > 0) n.classList.add('is-pos');
    if (p.score < 0) n.classList.add('is-neg');
    score.appendChild(n);
    score.appendChild(voteButton(p, -1));
    card.appendChild(score);

    // body
    var mid = el('div');
    mid.appendChild(el('p', 'pitch__text', p.body));

    var by = el('div', 'pitch__by');
    by.appendChild(document.createTextNode('pitched by ' + p.display_name + ' · ' + ago(p.created_at)));
    mid.appendChild(by);

    var toggle = el('button', 'pitch__replies',
      p.replies === 1 ? '1 reply' : p.replies + ' replies');
    toggle.addEventListener('click', function () { toggleReplies(p, card); });
    mid.appendChild(toggle);

    var thread = el('div', 'thread');
    thread.hidden = !openReplies[p.id];
    thread.dataset.thread = p.id;
    mid.appendChild(thread);
    if (openReplies[p.id]) loadReplies(p, thread);

    card.appendChild(mid);

    // status chip
    if (p.status !== 'approved') {
      var label = { building: 'In production', done: 'Animated' }[p.status] || p.status;
      card.appendChild(el('span', 'pitch__status pitch__status--' + p.status, label));
    }

    return card;
  }

  function renderBoard(rows) {
    var list = document.getElementById('board-list');
    list.textContent = '';

    if (!rows.length) {
      var empty = el('div', 'board-empty');
      empty.appendChild(el('h3', null, 'The board is empty'));
      empty.appendChild(el('p', null,
        'Nothing has been pitched yet. Somebody has to go first, and the first one gets read closest.'));
      list.appendChild(empty);
      return;
    }
    rows.forEach(function (p) { list.appendChild(renderPitch(p)); });
  }

  /* ---------------------------------------------------------------- data -- */

  function loadBoard() {
    if (!sb) return;
    return sb.from('board')
      .select('*')
      .in('status', ['approved', 'building', 'done'])
      .order('score', { ascending: false })
      .order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) { status(explain(res.error), 'bad'); return; }
        renderBoard(res.data || []);
      });
  }

  function loadMyVotes() {
    if (!sb || !me) { myVotes = {}; return Promise.resolve(); }
    return sb.from('votes').select('pitch_id,value').eq('user_id', me.id)
      .then(function (res) {
        myVotes = {};
        (res.data || []).forEach(function (v) { myVotes[v.pitch_id] = v.value; });
      });
  }

  function castVote(pitch, dir) {
    if (!me) return;
    var existing = myVotes[pitch.id];

    // Clicking the same arrow again takes the vote back.
    var op = existing === dir
      ? sb.from('votes').delete().eq('pitch_id', pitch.id).eq('user_id', me.id)
      : sb.from('votes').upsert(
          { pitch_id: pitch.id, user_id: me.id, value: dir },
          { onConflict: 'pitch_id,user_id' });

    op.then(function (res) {
      if (res.error) { status(explain(res.error), 'bad'); return; }
      if (existing === dir) { delete myVotes[pitch.id]; }
      else { myVotes[pitch.id] = dir; }
      status('');
      loadBoard();
    });
  }

  /* ------------------------------------------------------------- replies -- */

  function toggleReplies(p, card) {
    var thread = card.querySelector('[data-thread]');
    openReplies[p.id] = !openReplies[p.id];
    thread.hidden = !openReplies[p.id];
    if (openReplies[p.id]) loadReplies(p, thread);
  }

  function loadReplies(p, thread) {
    thread.textContent = '';
    thread.appendChild(el('p', 'thread__loading', 'Loading…'));

    sb.from('replies')
      .select('id,body,display_name,created_at,author_id')
      .eq('pitch_id', p.id)
      .order('created_at', { ascending: true })
      .then(function (res) {
        thread.textContent = '';
        if (res.error) { thread.appendChild(el('p', 'thread__loading', explain(res.error))); return; }

        (res.data || []).forEach(function (r) {
          var item = el('div', 'reply');
          item.appendChild(el('p', 'reply__body', r.body));
          var meta = el('div', 'reply__meta', r.display_name + ' · ' + ago(r.created_at));
          if (me && (r.author_id === me.id || isAdmin)) {
            var del = el('button', 'reply__del', 'delete');
            del.addEventListener('click', function () {
              sb.from('replies').delete().eq('id', r.id).then(function () {
                loadReplies(p, thread); loadBoard();
              });
            });
            meta.appendChild(del);
          }
          item.appendChild(meta);
          thread.appendChild(item);
        });

        if (!me) {
          thread.appendChild(el('p', 'thread__loading', 'Sign in to reply.'));
          return;
        }
        thread.appendChild(replyForm(p, thread));
      });
  }

  function replyForm(p, thread) {
    var wrap = el('form', 'reply-form');
    var ta = el('textarea');
    ta.maxLength = MAX_REPLY;
    ta.required = true;
    ta.rows = 2;
    ta.placeholder = 'Say something useful';
    ta.setAttribute('aria-label', 'Your reply');

    var send = el('button', 'btn btn--ghost btn--sm', 'Reply');
    send.type = 'submit';

    wrap.appendChild(ta);
    wrap.appendChild(send);

    wrap.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = ta.value.trim();
      if (!body) return;
      send.disabled = true;

      sb.from('replies').insert({
        pitch_id: p.id,
        author_id: me.id,
        display_name: displayName(),
        body: body
      }).then(function (res) {
        send.disabled = false;
        if (res.error) { status(explain(res.error), 'bad'); return; }
        ta.value = '';
        loadReplies(p, thread);
        loadBoard();
      });
    });

    return wrap;
  }

  /* ---------------------------------------------------------------- auth -- */

  function displayName() {
    return (me && (me.user_metadata.full_name || me.user_metadata.name)) ||
           (me && me.email ? me.email.split('@')[0] : 'anonymous');
  }

  function signIn() {
    sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/pitch.html' }
    });
  }

  function refreshAdmin() {
    if (!me) { isAdmin = false; return Promise.resolve(); }
    return sb.rpc('is_admin').then(function (res) {
      isAdmin = res.data === true;
    }).catch(function () { isAdmin = false; });
  }

  /* -------------------------------------------------------------- submit -- */

  function wireSubmit() {
    var form = document.getElementById('pitch-form');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!me) { status('Sign in first — it is how one vote stays one vote.', 'bad'); return; }

      var ta = form.querySelector('[name="pitch"]');
      var body = ta.value.trim();
      if (body.length < 3) { status('That is a bit short.', 'bad'); return; }
      if (body.length > MAX_PITCH) { status('Over the hundred.', 'bad'); return; }

      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      status('Sending…');

      sb.from('pitches').insert({
        body: body,
        display_name: displayName(),
        author_id: me.id
      }).then(function (res) {
        btn.disabled = false;
        if (res.error) { status(explain(res.error), 'bad'); return; }
        ta.value = '';
        ta.dispatchEvent(new Event('input'));
        status('Sent. Moiz reads every one — it appears here once he approves it.', 'good');
        notifyByEmail(body);
      });
    });
  }

  /* The database is the record; this is only so Moiz gets told. It reuses the
     Netlify form that already works, and a failure here is deliberately
     silent — the pitch is safely stored either way. */
  function notifyByEmail(body) {
    var data = new URLSearchParams({
      'form-name': 'pitch',
      'subject': 'New pitch from the Khanimator board',
      'name': displayName(),
      'email': (me && me.email) || '',
      'pitch': body
    });
    fetch('/pitched.html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: data.toString()
    }).catch(function () {});
  }

  /* ---------------------------------------------------------------- boot -- */

  function setSignedInUI() {
    var gate = document.getElementById('pitch-gate');
    var form = document.getElementById('pitch-form');
    if (!gate || !form) return;
    gate.hidden = !!me;
    form.hidden = !me;
  }

  function refreshAll() {
    return refreshAdmin()
      .then(loadMyVotes)
      .then(function () { renderAuth(); setSignedInUI(); return loadBoard(); });
  }

  function boot() {
    if (!CFG.url || !CFG.anonKey) {
      renderAuth();
      status('The board is not connected to its database yet.', 'bad');
      renderBoard([]);
      return;
    }
    if (!window.supabase) {
      status('Could not reach the board service. Reload in a moment.', 'bad');
      return;
    }

    sb = window.supabase.createClient(CFG.url, CFG.anonKey);

    sb.auth.getSession().then(function (res) {
      me = (res.data && res.data.session && res.data.session.user) || null;
      refreshAll();
    });

    sb.auth.onAuthStateChange(function (_evt, session) {
      me = (session && session.user) || null;
      refreshAll();
    });

    wireSubmit();
  }

  boot();
})();
