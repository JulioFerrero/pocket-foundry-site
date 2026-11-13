import type { TranslationKey } from './i18n';

/** The site's pages, as numbered sheets of one drawing. */
export const sheets = [
  { id: 'home', path: '/', nav: 'nav.home' },
  { id: 'phones', path: '/phones/', nav: 'nav.phones' },
  { id: 'guide', path: '/guide/', nav: 'nav.guide' },
  { id: 'faq', path: '/faq/', nav: 'nav.faq' },
] as const satisfies readonly { id: string; path: string; nav: TranslationKey }[];

export type SheetId = (typeof sheets)[number]['id'];
export const sheetNumber = (id: SheetId) => sheets.findIndex((sheet) => sheet.id === id) + 1;
