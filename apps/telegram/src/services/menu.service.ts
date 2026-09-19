import BaseService from './base.service';
import { mainMenuKeyboard, backToMainKeyboard } from '../keyboards/main';
import { setSession } from '../state/session';

export class MenuService extends BaseService {
  async showMain(chatId: number) {
    await setSession(chatId, { chatId, page: 'main' });
    return { text: '*RFSANZ Dashboard*
Welcome — choose an option:', keyboard: mainMenuKeyboard() };
  }

  async showDashboard(chatId: number) {
    await setSession(chatId, { chatId, page: 'dashboard' });
    return { text: '*Dashboard*\nOverview metrics (placeholder)', keyboard: backToMainKeyboard() };
  }

  async showTrading(chatId: number) {
    await setSession(chatId, { chatId, page: 'trading' });
    return { text: '*Trading*\nOpen trading actions', keyboard: backToMainKeyboard() };
  }

  async showMarket(chatId: number) {
    await setSession(chatId, { chatId, page: 'market' });
    return { text: '*Market*\nTop markets and movers', keyboard: backToMainKeyboard() };
  }

  async showPortfolio(chatId: number) {
    await setSession(chatId, { chatId, page: 'portfolio' });
    return { text: '*Portfolio*\nYour holdings summary', keyboard: backToMainKeyboard() };
  }

  async showOrders(chatId: number) {
    await setSession(chatId, { chatId, page: 'orders' });
    return { text: '*Orders*\nActive & recent orders', keyboard: backToMainKeyboard() };
  }

  async showPositions(chatId: number) {
    await setSession(chatId, { chatId, page: 'positions' });
    return { text: '*Positions*\nOpen positions', keyboard: backToMainKeyboard() };
  }

  async showSignals(chatId: number) {
    await setSession(chatId, { chatId, page: 'signals' });
    return { text: '*Signals*\nAI signals', keyboard: backToMainKeyboard() };
  }

  async showRisk(chatId: number) {
    await setSession(chatId, { chatId, page: 'risk' });
    return { text: '*Risk*\nRisk overview', keyboard: backToMainKeyboard() };
  }

  async showNews(chatId: number) {
    await setSession(chatId, { chatId, page: 'news' });
    return { text: '*News*\nLatest market news', keyboard: backToMainKeyboard() };
  }

  async showWatchlist(chatId: number) {
    await setSession(chatId, { chatId, page: 'watchlist' });
    return { text: '*Watchlist*\nYour watchlist', keyboard: backToMainKeyboard() };
  }

  async showSettings(chatId: number) {
    await setSession(chatId, { chatId, page: 'settings' });
    return { text: '*Settings*\nConfigure preferences', keyboard: backToMainKeyboard() };
  }

  async showHelp(chatId: number) {
    await setSession(chatId, { chatId, page: 'help' });
    return { text: '*Help*\nAvailable commands:\n/start — open main menu', keyboard: backToMainKeyboard() };
  }
}

export default new MenuService();
