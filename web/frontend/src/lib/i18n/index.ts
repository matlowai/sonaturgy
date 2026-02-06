import en from './en.json';
import zh from './zh.json';
import ja from './ja.json';

const translations: Record<string, any> = { en, zh, ja };

export type Language = 'en' | 'zh' | 'ja';

export function t(lang: Language, path: string): string {
  const keys = path.split('.');
  let val: any = translations[lang] || translations.en;
  for (const key of keys) {
    val = val?.[key];
  }
  return (val as string) || path;
}

export function tReplace(
  lang: Language,
  path: string,
  replacements: Record<string, string | number>
): string {
  let text = t(lang, path);
  for (const [key, value] of Object.entries(replacements)) {
    text = text.replace(`{${key}}`, String(value));
  }
  return text;
}
