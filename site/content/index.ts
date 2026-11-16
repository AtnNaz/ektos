import type { Locale } from '@/lib/i18n';
import { en, type Dict } from './en';
import { tr } from './tr';

const DICTS: Record<Locale, Dict> = { en, tr };
export const getDict = (lang: Locale): Dict => DICTS[lang];
export type { Dict };
