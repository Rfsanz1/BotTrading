import { InlineKeyboardButton } from 'telegraf/typings/core/types/typegram';

export function mainMenuKeyboard() {
  const rows: InlineKeyboardButton[][] = [
    [{ text: 'Dashboard', callback_data: 'menu:dashboard' }, { text: 'Trading', callback_data: 'menu:trading' }],
    [{ text: 'Market', callback_data: 'menu:market' }, { text: 'Portfolio', callback_data: 'menu:portfolio' }],
    [{ text: 'Orders', callback_data: 'menu:orders' }, { text: 'Positions', callback_data: 'menu:positions' }],
    [{ text: 'Signals', callback_data: 'menu:signals' }, { text: 'Risk', callback_data: 'menu:risk' }],
    [{ text: 'News', callback_data: 'menu:news' }, { text: 'Watchlist', callback_data: 'menu:watchlist' }],
    [{ text: 'Settings', callback_data: 'menu:settings' }, { text: 'Help', callback_data: 'menu:help' }],
  ];
  return { inline_keyboard: rows };
}

export function backToMainKeyboard() {
  return { inline_keyboard: [[{ text: '◀️ Back', callback_data: 'menu:main' }]] };
}
