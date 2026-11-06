declare var GM_addStyle: (style: string) => void;
declare var GM_getValue: (key: string) => any;
declare var GM_setValue: (key: string, value: any) => void;
declare var unsafeWindow: Window & typeof globalThis;

// Расширяем глобальный интерфейс для vitest.setup.ts
declare global {
  var GM_addStyle: (style: string) => void;
  var GM_getValue: (key: string) => any;
  var GM_setValue: (key: string, value: any) => void;
}

declare module '*.vue' {
  import { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

