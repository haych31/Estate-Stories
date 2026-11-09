require('dotenv').config();
const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'CLIENT_SECRET', 'GUILD_ID', 'BASE_URL', 'SESSION_SECRET', 'ADMIN_IDS'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) { console.error('Missing environment variables: ' + missing.join(', ')); process.exit(1); }

const bot = require('./bot');
const startWeb = require('./web');

bot.start().then(() => startWeb(bot)).catch((e) => { console.error(e); process.exit(1); });
