import en from './en.json';

/** Each language is one JSON file with the same keys as en.json. */
export const dictionaries = { en } as const;
export type Locale = keyof typeof dictionaries;
const defaultLocale: Locale = 'en';

type Dictionary = typeof en;
/** Dotted paths to the strings and lists in a dictionary: 'home.heading', 'faq.items'. */
type Key<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | readonly unknown[] ? `${Prefix}${K}` : Key<T[K], `${Prefix}${K}.`>;
}[keyof T & string];
export type TranslationKey = Key<Dictionary>;

/** The strings of the page's language (Astro.currentLocale), English when it has none of its own. */
export function useTranslations(current: string | undefined) {
  const locale: Locale = current && current in dictionaries ? (current as Locale) : defaultLocale;
  const dictionary = dictionaries[locale];
  const find = (key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dictionary);

  /** A string, with {name} filled from [params]. A missing key or parameter fails the build. */
  function t(key: TranslationKey, params: Record<string, string | number> = {}): string {
    const value = find(key);
    if (typeof value !== 'string') throw new Error(`i18n: "${key}" isn't a string in ${locale}.json`);
    return value.replace(/\{(\w+)\}/g, (_, name: string) => {
      if (!(name in params)) throw new Error(`i18n: "${key}" needs {${name}}`);
      return String(params[name]);
    });
  }

  /** A list of entries, such as the FAQ's questions. */
  function list<T>(key: TranslationKey): T[] {
    const value = find(key);
    if (!Array.isArray(value)) throw new Error(`i18n: "${key}" isn't a list in ${locale}.json`);
    return value as T[];
  }

  return { locale, t, list };
}
