import { Context } from 'telegraf';
import menuService from '../services/menu.service';

export async function handleMenuCallback(ctx: Context) {
  try {
    const data = ctx.callbackQuery?.data as string;
    const chatId = ctx.from?.id as number;
    if (!data || !chatId) return;
    // a simple router
    const [, page] = data.split(':');
    let pageRes;
    switch (page) {
      case 'main':
        pageRes = await menuService.showMain(chatId);
        break;
      case 'dashboard':
        pageRes = await menuService.showDashboard(chatId);
        break;
      case 'trading':
        pageRes = await menuService.showTrading(chatId);
        break;
      case 'market':
        pageRes = await menuService.showMarket(chatId);
        break;
      case 'portfolio':
        pageRes = await menuService.showPortfolio(chatId);
        break;
      case 'orders':
        pageRes = await menuService.showOrders(chatId);
        break;
      case 'positions':
        pageRes = await menuService.showPositions(chatId);
        break;
      case 'signals':
        pageRes = await menuService.showSignals(chatId);
        break;
      case 'risk':
        pageRes = await menuService.showRisk(chatId);
        break;
      case 'news':
        pageRes = await menuService.showNews(chatId);
        break;
      case 'watchlist':
        pageRes = await menuService.showWatchlist(chatId);
        break;
      case 'settings':
        pageRes = await menuService.showSettings(chatId);
        break;
      case 'help':
        pageRes = await menuService.showHelp(chatId);
        break;
      default:
        pageRes = await menuService.showMain(chatId);
    }

    // answer callback and edit message
    try { await ctx.answerCbQuery(); } catch (e) {}
    const text = pageRes.text;
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: pageRes.keyboard as any });
  } catch (err) {
    console.error('callback error', err);
  }
}

export default { handleMenuCallback };
