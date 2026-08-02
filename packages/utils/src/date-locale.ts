/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import {
  cs,
  de,
  enUS,
  es,
  fr,
  id,
  it,
  ja,
  ko,
  pl,
  ptBR,
  ro,
  ru,
  sk,
  tr,
  uk,
  vi,
  zhCN,
  zhTW,
  type Locale,
} from "date-fns/locale";

const DATE_FNS_LOCALES: Record<string, Locale> = {
  en: enUS,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  fr,
  es,
  ja,
  ru,
  it,
  cs,
  sk,
  de,
  ua: uk,
  pl,
  ko,
  "pt-BR": ptBR,
  id,
  ro,
  "vi-VN": vi,
  "tr-TR": tr,
};

/**
 * Maps a UI language code to the matching date-fns locale so relative-time
 * helpers (e.g. `calculateTimeAgo`) render in the active language.
 * Falls back to English for unsupported languages.
 */
export const getDateFnsLocaleForLanguage = (language: string): Locale => DATE_FNS_LOCALES[language] ?? enUS;
