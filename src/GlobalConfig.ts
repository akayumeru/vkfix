const DEFAULT_VALUES: Record<string, boolean | string> = {
  fixImagesZooming: false,
  pvExpand: false,
  pvExpandRightMonitorDefault: false,
  pvExpandLeftMonitorDefault: false,
  pvPhotoSwitchWheel: true,
  pvPhotoMoreActCommunityKeeper: true,
  pvPhotoMoreActAlbum: true,
  exportCommunityKeeperBtn: false,
  logging: false,
  'messenger.photo-stickers': false,
  'messenger.photo-stickers.albums': '-15,',
  switchTextLayout: false,
  fixFeedPhotoNavigation: false,
  groupInfoTeleport: false,
  clipsAutoUnmute: false,
}

export class GlobalConfig {
  private static cache: Record<string, any> | null = null

  private static loadConfig(): Record<string, any> {
    if (this.cache) {
      return this.cache
    }

    const gmValue = GM_getValue('vkfix')
    const rawConfig = typeof gmValue === 'string' ? gmValue : '{}'
    
    try {
      this.cache = JSON.parse(rawConfig)
    } catch {
      this.cache = {}
    }
    
    return this.cache!
  }

  private static saveConfig(): void {
    if (this.cache) {
      GM_setValue('vkfix', JSON.stringify(this.cache))
    }
  }

  static Config = {
    get(key: string): boolean | string {
      const config = GlobalConfig.loadConfig()
      
      if (key in config) {
        return config[key]
      }
      
      return DEFAULT_VALUES[key] ?? false
    },

    set(key: string, value: boolean | string): void {
      const config = GlobalConfig.loadConfig()
      config[key] = value
      GlobalConfig.saveConfig()
    },

    save(): void {
      GlobalConfig.saveConfig()
      
      // @ts-ignore
      if (typeof unsafeWindow !== 'undefined') {
        // @ts-ignore
        unsafeWindow.location.reload()
      } else {
        window.location.reload()
      }
    },
  }
}
