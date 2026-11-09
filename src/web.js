const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = () => process.env.BASE_URL.replace(/\/$/, '');
const admins = () => process.env.ADMIN_IDS.split(',').map((s) => s.trim());
const fmt = (t) => (t ? new Date(t).toLocaleString('en-GB') : '-');

function page(title, body, nav) {
  const links = nav
    ? `<nav>${[['/admin', 'Overview'], ['/admin/users', 'Verified users'], ['/admin/servers', 'Servers'], ['/admin/embed', 'Send embed'],
        ['/admin/announce', 'Announce'], ['/admin/tickets', 'Tickets'], ['/admin/settings', 'Settings'], ['/logout', 'Log out']]
        .map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}</nav>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} - Estate Stories</title><link rel="stylesheet" href="/style.css"></head>
<body><header><a class="brand" href="/">Estate Stories</a>${links}</header><main>${body}</main></body></html>`;
}

module.exports = function startWeb(bot) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, '../public')));
  app.use(session({
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 864e5 },
  }));

  const needAdmin = (req, res, next) => (req.session.admin ? next() : res.redirect('/login'));
  const back = (res, to, msg) => res.redirect(`${to}?msg=${encodeURIComponent(msg)}`);
  const flash = (req) => (req.query.msg ? `<p class="flash">${esc(req.query.msg)}</p>` : '');

  // ----- OAuth -----
  const authURL = (scope, state) => 'https://discord.com/oauth2/authorize?' + new URLSearchParams({
    client_id: process.env.CLIENT_ID, response_type: 'code', redirect_uri: base() + '/callback', scope, state, prompt: 'consent',
  });
  const startAuth = (type, scope) => (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauth = { state, type };
    req.session.save(() => res.redirect(authURL(scope, state)));
  };

  // ----- Public pages -----
  app.get('/', (req, res) => res.send(page('Home', `
    <section class="hero"><h1>Estate Stories</h1>
    <p>Your home on the FiveM server. Verify to get your role, join our community servers and hear about updates first.</p>
    <p><a class="btn" href="/verify">Verify with Discord</a> <a class="btn ghost" href="/login">Staff login</a></p></section>`)));

  app.get('/verify', (req, res) => res.send(page('Verify', `
    <section class="narrow"><h1>Verify your account</h1>
    <p>When you continue, Discord asks you to approve two things:</p>
    <ul><li><b>Your identity</b> so we can give you the verified role.</li>
    <li><b>Joining servers for you</b> so you can be added to Estate Stories community servers.</li></ul>
    <p>We also send occasional announcement DMs to verified members. You can stop them at any time with <code>/optout</code>, and you can remove our access in Discord under Settings, Authorized Apps.</p>
    <p><a class="btn" href="/auth/verify">I agree, continue to Discord</a></p></section>`)));

  app.get('/auth/verify', startAuth('verify', 'identify guilds.join'));
  app.get('/login', startAuth('login', 'identify'));

  app.get('/callback', async (req, res) => {
    const o = req.session.oauth;
    if (!o || !req.query.code || req.query.state !== o.state) return res.status(400).send(page('Error', '<p class="flash">Login expired. Go back and try again.</p>'));
    req.session.oauth = null;
    try {
      const tr = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET, grant_type: 'authorization_code',
          code: req.query.code, redirect_uri: base() + '/callback',
        }),
      });
      const t = await tr.json();
      if (!t.access_token) throw new Error('Discord refused the login');
      const user = await (await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${t.access_token}` } })).json();

      if (o.type === 'login') {
        if (!admins().includes(user.id)) return res.status(403).send(page('No access', '<p class="flash">Your account is not on the admin list.</p>'));
        req.session.admin = true;
        return req.session.save(() => res.redirect('/admin'));
      }
      db.prepare(`INSERT INTO verified(user_id,username,access_token,refresh_token,token_at,verified_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, access_token=excluded.access_token,
        refresh_token=excluded.refresh_token, token_at=excluded.token_at`)
        .run(user.id, user.username, t.access_token, t.refresh_token, Date.now(), Date.now());
      await bot.onVerified(user.id);
      res.send(page('Verified', `<section class="narrow"><h1>You are verified, ${esc(user.username)}.</h1><p>Head back to Discord. Your role and server access are being set up.</p></section>`));
    } catch (e) {
      console.error(e);
      res.status(500).send(page('Error', `<p class="flash">${esc(e.message)}</p>`));
    }
  });
  app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

  // ----- Admin -----
  app.use('/admin', needAdmin);

  app.get('/admin', (req, res) => {
    const c = (q) => db.prepare(q).get().n;
    res.send(page('Overview', `${flash(req)}<h1>Overview</h1><div class="stats">
      <div><b>${c('SELECT COUNT(*) n FROM verified')}</b>verified users</div>
      <div><b>${c('SELECT COUNT(*) n FROM tickets WHERE closed_at IS NULL')}</b>open tickets</div>
      <div><b>${c('SELECT COUNT(*) n FROM servers')}</b>linked servers</div>
      <div><b>${bot.client.guilds.cache.size}</b>servers the bot is in</div></div>
      <p>Bot status: ${bot.client.isReady() ? 'online' : 'offline'}. Start with <a href="/admin/settings">Settings</a>, then add servers.</p>`, true));
  });

  app.get('/admin/users', (req, res) => {
    const users = db.prepare('SELECT user_id,username,verified_at,dm_optout FROM verified ORDER BY verified_at DESC LIMIT 500').all();
    const servers = db.prepare('SELECT * FROM servers').all();
    const opts = servers.map((s) => `<option value="${esc(s.guild_id)}">${esc(s.name)}</option>`).join('');
    const rows = users.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.user_id)}</td><td>${fmt(u.verified_at)}</td><td>${u.dm_optout ? 'opted out' : 'yes'}</td>
      <td>${servers.length ? `<form method="post" action="/admin/join" class="inline"><input type="hidden" name="user" value="${esc(u.user_id)}">
      <select name="guild">${opts}</select><button>Add to server</button></form>` : ''}</td></tr>`).join('');
    res.send(page('Users', `${flash(req)}<h1>Verified users</h1><div class="scroll"><table>
      <tr><th>Name</th><th>ID</th><th>Verified</th><th>Gets DMs</th><th>Server access</th></tr>${rows || '<tr><td colspan="5">Nobody has verified yet.</td></tr>'}</table></div>`, true));
  });

  app.post('/admin/join', async (req, res) => {
    try { await bot.addToServer(req.body.user, req.body.guild); back(res, '/admin/users', 'Added to server.'); }
    catch (e) { back(res, '/admin/users', 'Failed: ' + e.message); }
  });

  app.get('/admin/servers', (req, res) => {
    const rows = db.prepare('SELECT * FROM servers').all().map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.guild_id)}</td>
      <td>${bot.client.guilds.cache.has(s.guild_id) ? 'bot is in' : 'bot NOT in server'}</td>
      <td><form method="post" action="/admin/servers/toggle" class="inline"><input type="hidden" name="id" value="${esc(s.guild_id)}"><button>${s.auto_join ? 'Auto-join: ON' : 'Auto-join: off'}</button></form>
      <form method="post" action="/admin/servers/delete" class="inline"><input type="hidden" name="id" value="${esc(s.guild_id)}"><button class="danger">Remove</button></form></td></tr>`).join('');
    res.send(page('Servers', `${flash(req)}<h1>Linked servers</h1>
      <p>Servers here can be offered to verified users. The bot must already be in each one (invite it with the same link). Auto-join adds people the moment they verify.</p>
      <form method="post" action="/admin/servers" class="row"><input name="id" placeholder="Server ID" required><input name="name" placeholder="Display name" required><button>Add server</button></form>
      <div class="scroll"><table><tr><th>Name</th><th>ID</th><th>Bot</th><th></th></tr>${rows || '<tr><td colspan="4">No servers linked yet.</td></tr>'}</table></div>`, true));
  });
  app.post('/admin/servers', (req, res) => {
    db.prepare('INSERT OR REPLACE INTO servers(guild_id,name,auto_join) VALUES(?,?,COALESCE((SELECT auto_join FROM servers WHERE guild_id=?),0))').run(req.body.id.trim(), req.body.name.trim(), req.body.id.trim());
    back(res, '/admin/servers', 'Server saved.');
  });
  app.post('/admin/servers/toggle', (req, res) => { db.prepare('UPDATE servers SET auto_join=1-auto_join WHERE guild_id=?').run(req.body.id); back(res, '/admin/servers', 'Updated.'); });
  app.post('/admin/servers/delete', (req, res) => { db.prepare('DELETE FROM servers WHERE guild_id=?').run(req.body.id); back(res, '/admin/servers', 'Removed.'); });

  app.get('/admin/embed', (req, res) => res.send(page('Embed', `${flash(req)}<h1>Send an embed</h1>
    <form method="post" class="stack"><input name="channel" placeholder="Channel ID" required><input name="title" placeholder="Title" required>
    <textarea name="description" rows="6" placeholder="Message" required></textarea><input name="color" placeholder="Colour, e.g. #c9a45c"><input name="image" placeholder="Image URL (optional)"><button>Send embed</button></form>`, true)));
  app.post('/admin/embed', async (req, res) => {
    try { await bot.sendEmbed(req.body.channel.trim(), req.body); back(res, '/admin/embed', 'Embed sent.'); }
    catch (e) { back(res, '/admin/embed', 'Failed: ' + e.message); }
  });

  app.get('/admin/announce', (req, res) => {
    const n = db.prepare('SELECT COUNT(*) n FROM verified WHERE dm_optout=0').get().n;
    res.send(page('Announce', `${flash(req)}<h1>Announcement DM</h1>
      <p>Goes to the <b>${n}</b> verified members who have not opted out, one every 1.5 seconds. It never DMs people who have not verified.</p>
      <form method="post" class="stack"><input name="title" placeholder="Title (optional)"><textarea name="message" rows="6" placeholder="Message" required></textarea><button>Send announcement</button></form>`, true));
  });
  app.post('/admin/announce', (req, res) => {
    bot.announce(req.body.message, req.body.title);
    back(res, '/admin/announce', 'Sending in the background. The result is posted to your log channel.');
  });

  app.get('/admin/tickets', (req, res) => {
    const rows = db.prepare('SELECT * FROM tickets ORDER BY id DESC LIMIT 200').all().map((t) => `<tr><td>#${t.id}</td><td>${esc(t.user_id)}</td><td>${fmt(t.opened_at)}</td><td>${t.closed_at ? 'closed ' + fmt(t.closed_at) : 'open'}</td></tr>`).join('');
    res.send(page('Tickets', `<h1>Tickets</h1><div class="scroll"><table><tr><th>Ticket</th><th>User ID</th><th>Opened</th><th>Status</th></tr>${rows || '<tr><td colspan="4">No tickets yet.</td></tr>'}</table></div>`, true));
  });

  const fields = [['verified_role_id', 'Verified role ID'], ['support_role_id', 'Support staff role ID'], ['ticket_category_id', 'Ticket category ID'], ['log_channel_id', 'Log channel ID']];
  app.get('/admin/settings', (req, res) => res.send(page('Settings', `${flash(req)}<h1>Settings</h1>
    <p>Turn on Developer Mode in Discord (Settings, Advanced), then right-click a role, channel or category and choose Copy ID.</p>
    <form method="post" class="stack">${fields.map(([k, l]) => `<label>${l}<input name="${k}" value="${esc(db.getSetting(k))}"></label>`).join('')}<button>Save settings</button></form>`, true)));
  app.post('/admin/settings', (req, res) => { fields.forEach(([k]) => db.setSetting(k, (req.body[k] || '').trim())); back(res, '/admin/settings', 'Settings saved.'); });

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Website running on port ${port}`));
};
