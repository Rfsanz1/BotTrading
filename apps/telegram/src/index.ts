import { Telegraf } from 'telegraf';
import { handleMenuCallback } from './callbacks';
import menuService from './services/menu.service';
import { logger } from './services/base.service';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
if (!token) {
  logger.warn('No TELEGRAM_BOT_TOKEN set - telegram app will not start in dev');
}

export const bot = new Telegraf(token, { telegram: { retryAfter: 10 } });

// Register command handlers
bot.start(async (ctx) => {
  const chatId = ctx.from?.id as number;
  const page = await menuService.showMain(chatId);
  await ctx.reply(page.text, { parse_mode: 'Markdown', reply_markup: page.keyboard as any });
});

// All callback_query routed to our callback handler
bot.on('callback_query', async (ctx) => {
  await handleMenuCallback(ctx);
});

bot.catch((err) => logger.error('bot error', err));

export default bot;
