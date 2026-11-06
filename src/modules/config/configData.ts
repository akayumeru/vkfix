import { Component } from 'vue'
import {
  Icon28ServicesOutline,
  Icon20PictureOutline,
  Icon28MessagesOutline,
  Icon20Users3Outline,
  Icon28AdvertisingOutline,
} from 'vue-vkontakte-icons'
import { GlobalConfig } from '../../GlobalConfig'

export interface ConfigFieldInfo {
  key: string
  label: string
  type: 'checkbox' | 'text'
  icon: string
  description?: string
  default?: boolean | string
}

export interface ConfigSectionInfo {
  id: string
  title: string
  icon: Component
  fieldKeys: string[]
}

// Группировка полей по секциям
export const configSections: ConfigSectionInfo[] = [
  {
    id: 'general',
    title: 'Общие настройки',
    icon: Icon28ServicesOutline,
    fieldKeys: ['logging'],
  },
  {
    id: 'photo-viewer',
    title: 'Просмотрщик фото',
    icon: Icon20PictureOutline,
    fieldKeys: [
      'fixImagesZooming',
      'pvExpand',
      'pvExpandRightMonitorDefault',
      'pvExpandLeftMonitorDefault',
      'pvPhotoSwitchWheel',
      'pvPhotoMoreActCommunityKeeper',
      'pvPhotoMoreActAlbum',
    ],
  },
  {
    id: 'messenger',
    title: 'Мессенджер',
    icon: Icon28MessagesOutline,
    fieldKeys: ['messenger.photo-stickers', 'messenger.photo-stickers.albums'],
  },
  {
    id: 'groups',
    title: 'Сообщества',
    icon: Icon20Users3Outline,
    fieldKeys: ['groupInfoTeleport'],
  },
  {
    id: 'other',
    title: 'Прочее',
    icon: Icon28AdvertisingOutline,
    fieldKeys: ['switchTextLayout', 'fixFeedPhotoNavigation', 'clipsAutoUnmute', 'exportCommunityKeeperBtn'],
  },
]

// Метаданные полей
export const configFieldsMeta: Record<string, ConfigFieldInfo> = {
  logging: {
    key: 'logging',
    label: 'Логирование в консоль',
    type: 'checkbox',
    icon: '📝'
  },
  fixImagesZooming: {
    key: 'fixImagesZooming',
    label: 'Исправить зумирование картинок при нестандартном масштабировании в Windows',
    type: 'checkbox',
    icon: '🖼️'
  },

  pvExpand: {
    key: 'pvExpand',
    label: 'Кнопка "Расширить" при просмотре фото',
    type: 'checkbox',
    icon: '🔲',
    description: 'Работает только с исправленным зумированием'
  },
  pvExpandRightMonitorDefault: {
    key: 'pvExpandRightMonitorDefault',
    label: 'Авторасширение на основном (правом) мониторе',
    type: 'checkbox',
    icon: '🖥️'
  },
  pvExpandLeftMonitorDefault: {
    key: 'pvExpandLeftMonitorDefault',
    label: 'Авторасширение на дополнительном (левом) мониторе',
    type: 'checkbox',
    icon: '🖥️'
  },
  pvPhotoSwitchWheel: {
    key: 'pvPhotoSwitchWheel',
    label: 'Переключение фото колёсиком мыши',
    type: 'checkbox',
    icon: '🎡'
  },
  pvPhotoMoreActCommunityKeeper: {
    key: 'pvPhotoMoreActCommunityKeeper',
    label: 'Кнопка "Открыть в Хранителе Групп"',
    type: 'checkbox',
    icon: '👥'
  },
  pvPhotoMoreActAlbum: {
    key: 'pvPhotoMoreActAlbum',
    label: 'Кнопка "Открыть в альбоме"',
    type: 'checkbox',
    icon: '📁'
  },

  exportCommunityKeeperBtn: {
    key: 'exportCommunityKeeperBtn',
    label: 'Кнопка "Создать бэкап из всех сообществ"',
    type: 'checkbox',
    icon: '💾',
    description: 'Возле приложения Хранитель Групп'
  },
  'messenger.photo-stickers': {
    key: 'messenger.photo-stickers',
    label: 'Всплывающие подсказки из фотографий с описанием',
    type: 'checkbox',
    icon: '🎭',
    description: "Дополнительно: в чате по нажатию на Ctrl+Space открывается модальное окно со всеми доступными фотографиями."
  },
  'messenger.photo-stickers.albums': {
    key: 'messenger.photo-stickers.albums',
    label: 'ID альбомов для подсказок (через запятую)',
    type: 'text',
    icon: '🗂️',
    description: 'Сохранённые фотографии: -15. Оставьте пустым для всех альбомов'
  },
  switchTextLayout: {
    key: 'switchTextLayout',
    label: 'Переключение раскладки на Ctrl+Q',
    type: 'checkbox',
    icon: '⌨️',
    description: 'Для введённого или выделенного текста в любом редактируемом месте'
  },
  fixFeedPhotoNavigation: {
    key: 'fixFeedPhotoNavigation',
    label: 'Возвращает пролистывание фото в ленте',
    type: 'checkbox',
    icon: '📸'
  },
  clipsAutoUnmute: {
    key: 'clipsAutoUnmute',
    label: 'Включать звук при открытии клипов',
    type: 'checkbox',
    icon: '🔊',
    description: 'Если звук выключен вручную, обратно он не включается'
  },
  groupInfoTeleport: {
    key: 'groupInfoTeleport',
    label: 'Заменить кнопку "Подробная информация" в сообществах',
    type: 'checkbox',
    icon: 'ℹ️'
  }
}

/**
 * Получить значение поля из GM_config
 */
export function getConfigValue(key: string): boolean | string {
  return GlobalConfig.Config.get(key) as boolean | string
}

/**
 * Установить значение поля в GM_config
 */
export function setConfigValue(key: string, value: boolean | string): void {
  GlobalConfig.Config.set(key, value)
}

/**
 * Получить все поля для секции
 */
export function getSectionFields(sectionId: string): ConfigFieldInfo[] {
  const section = configSections.find(s => s.id === sectionId)
  if (!section) return []
  
  return section.fieldKeys
    .map(key => configFieldsMeta[key])
    .filter(Boolean)
}
