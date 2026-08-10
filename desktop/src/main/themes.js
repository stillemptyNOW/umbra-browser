'use strict';
/**
 * Umbra ships one house theme plus a set of well-known open-source palettes.
 * Every borrowed palette is permissively licensed; see NOTICE.md in the
 * repository root for the attributions.
 */

const THEMES = {
  umbra: {
    label: 'Umbra',
    dark: true,
    credit: 'Umbra house palette, sampled from the mark',
    colors: {
      void: '#04030A',
      surface: '#0A0812',
      raised: '#14101F',
      hover: '#1D1730',
      border: '#2A2140',
      text: '#EDEAF7',
      muted: '#9A93B5',
      faint: '#655D80',
      accent: '#7726FA',
      accent2: '#A78BFA',
      success: '#3DD68C',
      warn: '#F2B155',
      danger: '#F2555A',
    },
  },

  'catppuccin-mocha': {
    label: 'Catppuccin Mocha',
    dark: true,
    credit: 'Catppuccin (MIT)',
    colors: {
      void: '#11111B',
      surface: '#1E1E2E',
      raised: '#313244',
      hover: '#45475A',
      border: '#45475A',
      text: '#CDD6F4',
      muted: '#A6ADC8',
      faint: '#6C7086',
      accent: '#CBA6F7',
      accent2: '#94E2D5',
      success: '#A6E3A1',
      warn: '#F9E2AF',
      danger: '#F38BA8',
    },
  },

  'catppuccin-latte': {
    label: 'Catppuccin Latte',
    dark: false,
    credit: 'Catppuccin (MIT)',
    colors: {
      void: '#DCE0E8',
      surface: '#EFF1F5',
      raised: '#E6E9EF',
      hover: '#DCE0E8',
      border: '#CCD0DA',
      text: '#4C4F69',
      muted: '#6C6F85',
      faint: '#9CA0B0',
      accent: '#8839EF',
      accent2: '#179299',
      success: '#40A02B',
      warn: '#DF8E1D',
      danger: '#D20F39',
    },
  },

  nord: {
    label: 'Nord',
    dark: true,
    credit: 'Nord by Arctic Ice Studio (MIT)',
    colors: {
      void: '#242933',
      surface: '#2E3440',
      raised: '#3B4252',
      hover: '#434C5E',
      border: '#4C566A',
      text: '#ECEFF4',
      muted: '#D8DEE9',
      faint: '#7B88A1',
      accent: '#88C0D0',
      accent2: '#8FBCBB',
      success: '#A3BE8C',
      warn: '#EBCB8B',
      danger: '#BF616A',
    },
  },

  'rose-pine': {
    label: 'Rosé Pine',
    dark: true,
    credit: 'Rosé Pine (MIT)',
    colors: {
      void: '#16141F',
      surface: '#191724',
      raised: '#1F1D2E',
      hover: '#26233A',
      border: '#403D52',
      text: '#E0DEF4',
      muted: '#908CAA',
      faint: '#6E6A86',
      accent: '#C4A7E7',
      accent2: '#9CCFD8',
      success: '#31748F',
      warn: '#F6C177',
      danger: '#EB6F92',
    },
  },

  'tokyo-night': {
    label: 'Tokyo Night',
    dark: true,
    credit: 'Tokyo Night by enkia (Apache-2.0)',
    colors: {
      void: '#16161E',
      surface: '#1A1B26',
      raised: '#24283B',
      hover: '#2F334D',
      border: '#3B4261',
      text: '#C0CAF5',
      muted: '#9AA5CE',
      faint: '#565F89',
      accent: '#7AA2F7',
      accent2: '#7DCFFF',
      success: '#9ECE6A',
      warn: '#E0AF68',
      danger: '#F7768E',
    },
  },

  'gruvbox-dark': {
    label: 'Gruvbox Dark',
    dark: true,
    credit: 'Gruvbox by morhetz (MIT)',
    colors: {
      void: '#1D2021',
      surface: '#282828',
      raised: '#3C3836',
      hover: '#504945',
      border: '#504945',
      text: '#EBDBB2',
      muted: '#BDAE93',
      faint: '#928374',
      accent: '#D3869B',
      accent2: '#8EC07C',
      success: '#B8BB26',
      warn: '#FABD2F',
      danger: '#FB4934',
    },
  },

  'solarized-light': {
    label: 'Solarized Light',
    dark: false,
    credit: 'Solarized by Ethan Schoonover (MIT)',
    colors: {
      void: '#EEE8D5',
      surface: '#FDF6E3',
      raised: '#EEE8D5',
      hover: '#E4DCC6',
      border: '#D6CFB8',
      text: '#073642',
      muted: '#586E75',
      faint: '#93A1A1',
      accent: '#6C71C4',
      accent2: '#2AA198',
      success: '#859900',
      warn: '#B58900',
      danger: '#DC322F',
    },
  },
};

const DEFAULT_THEME = 'umbra';

function getTheme(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME];
}

function listThemes() {
  return Object.entries(THEMES).map(([id, t]) => ({
    id,
    label: t.label,
    dark: t.dark,
    credit: t.credit,
    swatch: [t.colors.surface, t.colors.accent, t.colors.accent2],
  }));
}

module.exports = { THEMES, DEFAULT_THEME, getTheme, listThemes };
