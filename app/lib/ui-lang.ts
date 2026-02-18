"use client";

import { enMessages, type UiTranslationKey } from "@/app/i18n/messages/en";
import { ukMessages } from "@/app/i18n/messages/uk";

export type UiLang = "en" | "uk";

const UI_LANG_KEY = "mc_ui_lang";
const dictionaries = {
  en: enMessages,
  uk: ukMessages,
} as const;

export function readUiLang(): UiLang {
  if (typeof window === "undefined") return "en";
  const raw = window.localStorage.getItem(UI_LANG_KEY);
  return raw === "uk" ? "uk" : "en";
}

export function writeUiLang(lang: UiLang) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(UI_LANG_KEY, lang);
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? `{${key}}` : String(value);
  });
}

export function t(
  lang: UiLang,
  key: UiTranslationKey,
  params?: Record<string, string | number>,
): string {
  const dictionary = dictionaries[lang] ?? dictionaries.en;
  const template = dictionary[key] ?? dictionaries.en[key] ?? key;
  return interpolate(template, params);
}
