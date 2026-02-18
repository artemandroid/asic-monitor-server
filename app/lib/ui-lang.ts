"use client";

export type UiLang = "en" | "uk";

const UI_LANG_KEY = "mc_ui_lang";

export function readUiLang(): UiLang {
  if (typeof window === "undefined") return "en";
  const raw = window.localStorage.getItem(UI_LANG_KEY);
  return raw === "uk" ? "uk" : "en";
}

export function writeUiLang(lang: UiLang) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(UI_LANG_KEY, lang);
}

export function tr(lang: UiLang, en: string, uk: string): string {
  return lang === "uk" ? uk : en;
}
