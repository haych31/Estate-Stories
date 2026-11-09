const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits,
} = require('discord.js');
const db = require('./db');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BRAND = 0xc9a45c;

// ---------- Commands ----------
const admin = PermissionFlagsBits.Administrator;
const commands = [
  new SlashCommandBuilder().setName('ticketpanel').setDescription('Post the ticket panel here').setDefaultMemberPermissions(admin),
  new SlashCommandBuilder().setName('verifypanel').setDescription('Post the verification panel here').setDefaultMemberPermissions(admin),
  new SlashCommandBuilder().setName('embed').setDescription('Send a custom embed').setDefaultMemberPermissions(admin)
    .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true))
    .addStringOption((o) => o.setName('description').setDescription('Text (use \\n for new lines)').setRequired(true))
    .addStringOption((o) => o.setName('color').setDescription('Hex colour, e.g. #c9a45c'))
    .addStringOption((o) => o.setName('image').setDescription('Image URL'))
    .addChannelOption((o) => o.setName('channel').setDescription('Where to send it (default: here)')),
  new SlashCommandBuilder().setName('announce').setDescription('DM an announcement to verified members who have not opted out').setDefaultMemberPermissions(admin)
    .addStringOption((o) => o.setName('message').setDescription('Announcement text').setRequired(true))
    .addStringOption((o) => o.setName('title').setDescription('Title (default: Estate Stories)')),
  new SlashCommandBuilder().setName('optout').setDescription('Stop receiving Estate Stories announcement DMs'),
  new SlashCommandBuilder().setName('optin').setDescription('Receive Estate Stories announcement DMs again'),
  new SlashCommandBuilder().setName('ping').setDescription('Check the bot is alive'),
].map((c) => c.toJSON());

// ---------- Helpers ----------
const parseColor = (c) => (c && /^#?[0-9a-f]{6}$/i.test(c) ? parseInt(c.replace('#', ''), 16) : BRAND);

async function sendEmbed(channelId, { title, description, color, image }) {
  const ch = await client.channels.fetch(channelId);
  const e = new EmbedBuilder().setTitle(title).setDescription(String(description).replace(/\\n/g, '\n')).setColor(parseColor(color));
  if (image) e.setImage(image);
  await ch.send({ embeds: [e] });
}

async function log(text) {
  const id = db.getSetting('log_channel_id');
  if (!id) return;
  try { await (await client.channels.fetch(id)).send(text); } catch {}
}

async function announce(text, title) {
  const rows = db.prepare('SELECT user_id FROM verified WHERE dm_optout=0').all();
  let sent = 0, failed = 0;
  for (const r of rows) {
    try {
      const u = await client.users.fetch(r.user_id);
      await u.send({
        embeds: [new EmbedBuilder().setTitle(title || 'Estate Stories').setDescription(text).setColor(BRAND)
          .setFooter({ text: 'You get this because you verified with Estate Stories. Use /optout to stop.' })],
      });
      sent++;
    } catch { failed++; }
    await sleep(1500); // stay well inside Discord rate limits
  }
  await log(`Announcement finished: ${sent} sent, ${failed} failed.`);
  return { sent, failed };
}

async function freshToken(row) {
  if (Date.now() - row.token_at < 5 * 864e5) return row.access_token;
  const r = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET,
      grant_type: 'refresh_token', refresh_token: row.refresh_token,
    }),
  });
  const t = await r.json();
  if (!t.access_token) throw new Error('Token expired - user must verify again');
  db.prepare('UPDATE verified SET access_token=?, refresh_token=?, token_at=? WHERE user_id=?')
    .run(t.access_token, t.refresh_token, Date.now(), row.user_id);
  return t.access_token;
}

async function addToServer(userId, guildId) {
  const row = db.prepare('SELECT * FROM verified WHERE user_id=?').get(userId);
  if (!row) throw new Error('User has not verified');
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('Bot is not in that server');
  const accessToken = await freshToken(row);
  await guild.members.add(userId, { accessToken });
}

async function onVerified(userId) {
  const results = [];
  try {
    const roleId = db.getSetting('verified_role_id');
    if (roleId && process.env.GUILD_ID) {
      const m = await (await client.guilds.fetch(process.env.GUILD_ID)).members.fetch(userId);
      await m.roles.add(roleId);
    }
  } catch (e) { results.push('role: ' + e.message); }
  for (const s of db.prepare('SELECT * FROM servers WHERE auto_join=1').all()) {
    try { await addToServer(userId, s.guild_id); } catch (e) { results.push(`${s.name}: ${e.message}`); }
  }
  await log(`<@${userId}> verified.${results.length ? ' Issues: ' + results.join('; ') : ''}`);
}

// ---------- Interactions ----------
client.on('interactionCreate', async (i) => {
  try {
    if (i.isChatInputCommand()) return await handleCommand(i);
    if (i.isButton() && i.customId === 'ticket_open') return await openTicket(i);
    if (i.isButton() && i.customId === 'ticket_close') return await closeTicket(i);
  } catch (e) {
    console.error(e);
    const msg = { content: 'Something went wrong. Check the bot logs.', ephemeral: true };
    if (i.deferred || i.replied) i.followUp(msg).catch(() => {}); else i.reply(msg).catch(() => {});
  }
});

async function handleCommand(i) {
  const n = i.commandName;
  if (n === 'ping') return i.reply({ content: 'Pong.', ephemeral: true });
  if (n === 'optout' || n === 'optin') {
    db.prepare('UPDATE verified SET dm_optout=? WHERE user_id=?').run(n === 'optout' ? 1 : 0, i.user.id);
    return i.reply({ content: n === 'optout' ? 'Done. No more announcement DMs.' : 'Done. You will get announcements again.', ephemeral: true });
  }
  if (n === 'ticketpanel') {
    const e = new EmbedBuilder().setTitle('Estate Stories Support').setColor(BRAND)
      .setDescription('Need help, want to report a player, or have a question? Press the button and a private channel opens for you and our staff.');
    await i.channel.send({ embeds: [e], components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_open').setLabel('Open a ticket').setStyle(ButtonStyle.Primary))] });
    return i.reply({ content: 'Ticket panel posted.', ephemeral: true });
  }
  if (n === 'verifypanel') {
    const e = new EmbedBuilder().setTitle('Verify to enter Estate Stories').setColor(BRAND)
      .setDescription('Press the button, log in with Discord and approve. You get the verified role straight away. By verifying you also agree to be added to our linked community servers and to receive occasional announcements (turn off any time with /optout).');
    await i.channel.send({ embeds: [e], components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Verify').setStyle(ButtonStyle.Link).setURL(process.env.BASE_URL.replace(/\/$/, '') + '/verify'))] });
    return i.reply({ content: 'Verification panel posted.', ephemeral: true });
  }
  if (n === 'embed') {
    const ch = i.options.getChannel('channel') || i.channel;
    await sendEmbed(ch.id, {
      title: i.options.getString('title'), description: i.options.getString('description'),
      color: i.options.getString('color'), image: i.options.getString('image'),
    });
    return i.reply({ content: 'Embed sent.', ephemeral: true });
  }
  if (n === 'announce') {
    await i.reply({ content: 'Sending in the background (about 1.5s per person). I will log the result.', ephemeral: true });
    announce(i.options.getString('message'), i.options.getString('title'));
  }
}

async function openTicket(i) {
  const existing = db.prepare('SELECT * FROM tickets WHERE user_id=? AND closed_at IS NULL').get(i.user.id);
  if (existing) return i.reply({ content: `You already have a ticket open: <#${existing.channel_id}>`, ephemeral: true });
  const staff = db.getSetting('support_role_id');
  const overwrites = [
    { id: i.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
  ];
  if (staff) overwrites.push({ id: staff, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  const cat = db.getSetting('ticket_category_id');
  const ch = await i.guild.channels.create({
    name: `ticket-${i.user.username}`.slice(0, 90), type: ChannelType.GuildText,
    parent: cat || null, permissionOverwrites: overwrites,
  });
  db.prepare('INSERT INTO tickets(channel_id,user_id,opened_at) VALUES(?,?,?)').run(ch.id, i.user.id, Date.now());
  await ch.send({
    content: `<@${i.user.id}>${staff ? ` <@&${staff}>` : ''}`,
    embeds: [new EmbedBuilder().setColor(BRAND).setTitle('Ticket opened').setDescription('Tell us what you need and staff will reply shortly.')],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('Close ticket').setStyle(ButtonStyle.Danger))],
  });
  await log(`Ticket opened by <@${i.user.id}>: <#${ch.id}>`);
  return i.reply({ content: `Your ticket: <#${ch.id}>`, ephemeral: true });
}

async function closeTicket(i) {
  const t = db.prepare('SELECT * FROM tickets WHERE channel_id=? AND closed_at IS NULL').get(i.channel.id);
  if (!t) return i.reply({ content: 'This is not an open ticket.', ephemeral: true });
  const staff = db.getSetting('support_role_id');
  const ok = i.user.id === t.user_id || i.memberPermissions.has(PermissionFlagsBits.ManageChannels) || (staff && i.member.roles.cache.has(staff));
  if (!ok) return i.reply({ content: 'Only staff or the ticket owner can close this.', ephemeral: true });
  db.prepare('UPDATE tickets SET closed_at=? WHERE id=?').run(Date.now(), t.id);
  await i.reply('Closing in 5 seconds...');
  await log(`Ticket #${t.id} closed by <@${i.user.id}>.`);
  setTimeout(() => i.channel.delete().catch(() => {}), 5000);
}

async function start() {
  client.once('ready', async () => {
    console.log(`Bot online as ${client.user.tag}`);
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log('Slash commands registered');
  });
  await client.login(process.env.DISCORD_TOKEN);
}

module.exports = { client, start, sendEmbed, announce, addToServer, onVerified };
