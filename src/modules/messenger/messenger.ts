import {Logger} from "../../classes/Logger";
import {GlobalConfig} from "../../GlobalConfig";
import {querySelectorWithTimeout} from "../../common/helpers/querySelectorWithTimeout";
import {APIInteractor} from "../../classes/ApiInteractor";
import {extractQuotedTexts} from "../../common/helpers/extractQuotedTexts";
import {createApp, h, ref, shallowReactive, watch} from "vue";
import VPhotoStickersPopup from "./VPhotoStickersPopup.vue";
import VPhotoStickersGallery from "./VPhotoStickersGallery.vue";
import {VKLocation} from "../../classes/VKLocation";
import {Album, Photo, PhotoSticker} from "./types";
import {initializeStickerSearch, smartStickerSearch} from "../../classes/AdvancedStickerFilter";
import {debounce} from "es-toolkit";
import {useEventListener} from "@vueuse/core";
import {PhotoCache} from "../../classes/PhotoCache";
import {getPhotoKey} from "./photoStickerUtils";


/**
 * Сколько стикеров показываем в панели над полем ввода.
 * Панель прокручивается по горизонтали, больше туда всё равно не смотрят,
 * а лишние картинки грузились бы на каждое нажатие клавиши.
 */
const STICKERS_POPUP_LIMIT = 30;

/** Максимум, который photos.get отдаёт за один вызов. */
const PHOTOS_GET_COUNT = 1000;

/** Сколько ждём отрисовку мессенджера: при открытии по прямой ссылке React успевает не сразу. */
const MESSENGER_RENDER_TIMEOUT_MS = 15000;

const isEnabledPhotoStickers = GlobalConfig.Config.get('messenger.photo-stickers') as boolean;
const photoStickersAlbumIds = GlobalConfig.Config.get('messenger.photo-stickers.albums') as string;
let _initPhotoStickers = ref<boolean | null>(false) // null - идёт инициализация
const popupStickerEl = ref<HTMLDivElement | null>(null)
const convoMainComposer = ref<HTMLDivElement | null>(null)
const composerInputInput = ref<HTMLSpanElement | null>(null)
const messageText = ref('')
const debounceShowStickers = debounce(showStickers, 200)
const photoCache = PhotoCache.getInstance()
let albumIds: number[] | undefined
let needUpdatePhotos = true

/** Перезапрашиваем альбомы из-за незагрузившихся картинок только один раз за сессию. */
let isReloadingFailedPhotos = false

/** Фото-стикеры по ключу `${owner_id}_${id}` - чтобы искать подсказку по ссылке на фото в DOM. */
const photoStickersById = new Map<string, PhotoSticker>()

/** Счётчик обновлений {@link photoStickersById} - на него подписываются потребители вне мессенджера. */
export const photoStickersVersion = ref(0)

export function getPhotoSticker(ownerId: number, photoId: number): PhotoSticker | undefined {
    return photoStickersById.get(getPhotoKey(ownerId, photoId))
}

const stickersStore = shallowReactive<{
    photos: PhotoSticker[]
    stickers: PhotoSticker[]
    teleportEl?: HTMLDivElement
    onSendSticker(sticker: PhotoSticker): void
    onLoadFailed(sticker: PhotoSticker): void
}>({
    photos: [], stickers: [], onLoadFailed: async (sticker: PhotoSticker) => {
        if (isReloadingFailedPhotos || albumIds === undefined) {
            return
        }

        // картинка не открылась даже после повторов - значит ссылки в кэше мёртвые, забираем альбомы заново
        isReloadingFailedPhotos = true
        Logger.error('messenger: фото не загрузилось после всех попыток, перезапрашиваем альбомы', sticker.photo)
        await loadPhotos(albumIds)
        // показанные подсказки держат старые объекты с мёртвыми ссылками - пересобираем их
        await showStickers(messageText.value)
    }, onSendSticker: async (sticker: PhotoSticker) => {
        stickersStore.stickers = []
        Logger.info('onSendSticker: sticker', sticker)
        const peer_id = VKLocation.getPeerId()
        if (peer_id === undefined) {
            Logger.info('onSendSticker: not found peer_id', VKLocation.getQueryParams())
            return
        }

        const composerDrafts = await getComposerDrafts()
        Logger.info('onSendSticker: composerDrafts', composerDrafts)
        const cmid: number | undefined = composerDrafts.length !== 1 ? undefined : composerDrafts[0]?.reply?.cmid
        await APIInteractor.callApi({
            method: 'messages.send',
            data: {
                peer_id,
                random_id: Math.round(Math.random() * 10000000),
                attachment: `photo${sticker.photo.owner_id}_${sticker.photo.id}`,
                forward: cmid === undefined ? undefined : JSON.stringify({
                    peer_id,
                    conversation_message_ids: cmid,
                    is_reply: 1,
                })
            }
        })

        // скроллим мессенджер вниз
        setTimeout(() => {
            const el = popupStickerEl.value.querySelector(`.ConvoHistory__wrapper > div[data-scrollbar="scrollable"]`)
            if (el) {
                el.scrollTo(0, el.scrollHeight)
            }
        }, 200)

        // сбрасываем текст с поля ввода
        if (composerInputInput.value) {
            composerInputInput.value.textContent = ''
        }

        // сбрасываем ответное сообщение
        if (cmid !== undefined) {
            const resetEl = popupStickerEl.value.querySelector<HTMLButtonElement>('.Composer__button.ComposerOverMessage__close')
            Logger.info('onSendSticker: resetEl', resetEl)
            resetEl.click()
        }
    }
})

const galleryState = shallowReactive<{
    visible: boolean
    onSendSticker(sticker: PhotoSticker): void
}>({
    visible: false,
    onSendSticker: async (sticker: PhotoSticker) => {
        stickersStore.onSendSticker(sticker)
    }
})

useEventListener(composerInputInput, 'keydown', (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
        return
    }

    if ((e.key === 'Escape' || e.key === 'Enter' || !composerInputInput.value)) {
        if (stickersStore.stickers.length) {
            if (e.key === 'Escape') {
                e.stopPropagation()
            }

            stickersStore.stickers = []
        }

        // даже если стикеров нет, всё равно дальше не обрабатываем, чтобы стикеры повторно не появились после скрытия вкшных стикеров на Escape
        return
    }

    const currentText = getComposerText(composerInputInput.value)

    setTimeout(() => {
        if (!composerInputInput.value) {
            return
        }

        // Игнорируем, если текст не изменился
        const newText = getComposerText(composerInputInput.value);
        if (currentText === newText) {
            return
        }

        stickersStore.stickers = []
        messageText.value = newText
        debounceShowStickers(newText)
        Logger.info(`messenger: keydown ${e.key}, text: ${getComposerText(composerInputInput.value)}`)
    })
}, {capture: true})

useEventListener('keydown', (e: KeyboardEvent) => {
    if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation()
        galleryState.visible = !galleryState.visible
    }
}, {capture: true})

useEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && galleryState.visible) {
        e.preventDefault()
        e.stopPropagation()
        galleryState.visible = false
    }
}, {capture: true})

useEventListener(composerInputInput, 'input', () => {
    if (albumIds !== undefined && needUpdatePhotos) {
        loadPhotos(albumIds).then()
        needUpdatePhotos = false
    }
})

useEventListener(composerInputInput, 'focus', () => {
    showStickers(getComposerText(composerInputInput.value)).then()
})

useEventListener('focusout', () => {
  if (!stickersStore.stickers.length) {
    return
  }

  setTimeout(() => {
    if (document.activeElement === composerInputInput.value || document.activeElement.classList.contains('v-photo-sticker-img')) {
      return
    }

    stickersStore.stickers = []
  })
})

watch(popupStickerEl, (popupStickerEl) => {
    if (!popupStickerEl) {
        return
    }

    convoMainComposer.value = popupStickerEl.querySelector('.ConvoMain__composer')
}, {flush: 'sync'})

watch(convoMainComposer, (convoMainComposer) => {
    Logger.info('messenger: watch convoMainComposer', convoMainComposer)
    if (!convoMainComposer) {
        return
    }

    observer.disconnect()
    observer.observe(convoMainComposer, observerConfig)
    updateComposerInputInput()
}, {flush: 'sync'})

watch(composerInputInput, (composerInputInput) => {
    Logger.info('messenger: watch composerInputInput', composerInputInput)
    if (!composerInputInput) {
        return
    }

    stickersStore.teleportEl = convoMainComposer.value.querySelector('.ConvoMain__composerContent.ConvoComposer')
    messageText.value = composerInputInput.textContent
}, {flush: 'sync'})

watch([composerInputInput, messageText], () => {
    showStickers(messageText.value).then()
})

// возвращает инфу о текущем вводе сообщения (например reply)
async function getComposerDrafts(): Promise<ComposerDraft[]> {
    const peer_id = VKLocation.getPeerId()
    if (peer_id === undefined) {
        Logger.info('messenger: not found peer_id', VKLocation.getQueryParams())
        return
    }

    return (await MECommonContext)?.store.getState().composerDrafts?.[peer_id] ?? []
}


const observerConfig: MutationObserverInit = {
    childList: true
};

function updateComposerInputInput() {
    stickersStore.stickers = []
    composerInputInput.value = convoMainComposer.value?.querySelector<HTMLSpanElement>('.ComposerInput__input')
    if (!composerInputInput.value) {
        Logger.info('messenger: not found .ComposerInput__input')
        return
    }

    messageText.value = composerInputInput.value?.textContent ?? '';
    if (!messageText.value) {
        Logger.info('messenger observer: messageText empty:');
        stickersStore.stickers = []
        return
    }
}

const observerCallback: MutationCallback = (mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'characterData' || mutation.type === 'childList') {
            updateComposerInputInput()
        }
    });
};

const observer = new MutationObserver(observerCallback);

function getConvoComposerEditing() {
    return popupStickerEl.value?.querySelector('.ConvoComposer__editing')
}

export async function messenger() {
    // при повторной инициализации сбрасываем предыдущие подсказки
    stickersStore.stickers = []

    if (!isEnabledPhotoStickers) {
        return
    }

    // при переходе внутри VK мессенджер уже отрисован, а при открытии по прямой ссылке - ещё нет, поэтому ждём
    const reforgedRootEl = await querySelectorWithTimeout({
        selectors: '#reforged-root',
        timeout: MESSENGER_RENDER_TIMEOUT_MS,
    });
    if (!reforgedRootEl) {
        Logger.info('messenger: not found #reforged-root')
        return;
    }

    popupStickerEl.value = await querySelectorWithTimeout<HTMLDivElement>({
        selectors: `#popup-sticker-convo-main-history-container`,
        timeout: MESSENGER_RENDER_TIMEOUT_MS,
    });
    if (!popupStickerEl.value) {
        Logger.info('messenger: not found #popup-sticker-convo-main-history-container')
        return;
    }


    Logger.info('messenger: composerInputInput success!', composerInputInput.value)
    await initPhotoStickers()
    Logger.info('messenger: success! stickersStore:', stickersStore)
}


function getWords(str: string) {
    // Разделяем по пробелам, но сохраняем эмодзи последовательности
    const tokens = str.toLowerCase().split(/[\s]+/).filter(x => x.length > 0);
    
    const result: string[] = [];
    for (const token of tokens) {
        // Извлекаем буквы/цифры
        const letterMatches = token.match(/[а-яёa-z0-9]+/g);
        if (letterMatches) {
            result.push(...letterMatches);
        }
        
        // Извлекаем эмодзи (включая вариационные селекторы и модификаторы)
        // Простой подход: извлекаем всё, что содержит emoji code points
        const emojiMatches = token.match(/(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|\u2764|\u26A0|\u2693|\u2614|\u26C4|\u26C5|\u267F|\u231A|\u231B|\u23E9|\u23EA|\u23EB|\u23EC|\u23ED|\u23EE|\u23EF|\u23F0|\u23F1|\u23F2|\u23F3|\u25FB|\u25FC|\u25FE|\u25FF|\u2600|\u2601|\u2602|\u2603|\u260E|\u2611|\u2615|\u2618|\u261D|\u2620|\u2622|\u2623|\u2626|\u262A|\u262E|\u262F|\u2638|\u2639|\u263A|\u2648|\u2649|\u264A|\u264B|\u264C|\u264D|\u264E|\u264F|\u2650|\u2651|\u2652|\u2653|\u2660|\u2663|\u2665|\u2666|\u2668|\u267B|\u267E|\u267F|\u2692|\u2693|\u2694|\u2695|\u2696|\u2697|\u2699|\u269B|\u269C|\u26A1|\u26AA|\u26AB|\u26B0|\u26B1|\u26BD|\u26BE|\u26C4|\u26C5|\u26CE|\u26CF|\u26D1|\u26D3|\u26D4|\u26E9|\u26EA|\u26F0|\u26F1|\u26F2|\u26F3|\u26F4|\u26F5|\u26F7|\u26F8|\u26F9|\u26FA|\u26FD|\u2702|\u2705|\u2708|\u2709|\u270A|\u270B|\u270C|\u270D|\u270F|\u2712|\u2714|\u2716|\u271D|\u2721|\u2728|\u2733|\u2734|\u2744|\u2747|\u274C|\u274E|\u2753|\u2754|\u2755|\u2757|\u2763|\u2764|\u2795|\u2796|\u2797|\u27A1|\u27B0|\u27BF|\u2934|\u2935|\u2B05|\u2B06|\u2B07|\u2B1B|\u2B1C|\u2B50|\u2B55|\u3030|\u303D|\u3297|\u3299)+[\uFE0E\uFE0F\u200D\u1F3FB\u1F3FC\u1F3FD\u1F3FE\u1F3FF\u20E3]*/gu);
        if (emojiMatches) {
            result.push(...emojiMatches);
        }
    }
    
    return result;
}

async function getAlbumsIds(): Promise<number[]> {
    const albumsIds: number[] = photoStickersAlbumIds
        .split(',')
        .map(x => x.trim())
        .filter(x => x.length)
        .map(x => Number(x))
    if (albumsIds.length > 0) {
        return albumsIds
    }

    const albumsResult = await APIInteractor.callApi({
        method: 'photos.getAlbums',
        data: {
            need_system: 1,
            album_ids: photoStickersAlbumIds,
        }
    })
    const albums: Album[] = albumsResult.response.items
    return albums.map(x => x.id)
}

export async function initPhotoStickers(): Promise<void> {
    if (!isEnabledPhotoStickers || _initPhotoStickers.value === true) {
        return
    }

    // если инициализация уже идёт, ждем завершения
    if (_initPhotoStickers.value === null) {
        return new Promise((resolve) => {
            watch(_initPhotoStickers, () => {
                resolve()
            }, {once: true})
        })
    }

    _initPhotoStickers.value = null
    try {
        albumIds = await getAlbumsIds()
        const cachedPhotos: PhotoSticker[] = []
        for (const album_id of albumIds) {
            cachedPhotos.push(...(await photoCache.getPhotos(album_id) ?? []))
        }

        if (cachedPhotos.length) {
            setPhotos(cachedPhotos)
        } else {
            await loadPhotos(albumIds)
        }

        const stickersAppEl = document.createElement('div')
        const app = createApp({render: () => h(VPhotoStickersPopup, stickersStore)});
        app.mount(stickersAppEl);
        document.body.appendChild(stickersAppEl)

        const galleryAppEl = document.createElement('div')
        const galleryApp = createApp({
            render: () => h(VPhotoStickersGallery, {
                visible: galleryState.visible,
                photos: stickersStore.photos,
                onSendSticker: galleryState.onSendSticker,
                onClose: () => { galleryState.visible = false }
            })
        });
        galleryApp.mount(galleryAppEl);
        document.body.appendChild(galleryAppEl)

        _initPhotoStickers.value = true
        Logger.info('messenger: cached init', stickersStore.photos)
    } catch (ex: any) {
        Logger.error('messenger: initPhotoStickers', ex)
        stickersStore.photos = []
        stickersStore.stickers = []
        _initPhotoStickers.value = false
    }
}

function photosToStickers(photos: Photo[]): PhotoSticker[] {
    const newArray: PhotoSticker[] = []
    for (const photo of photos) {
        if (!photo.text) {
            continue;
        }

        const suggestions = extractQuotedTexts(photo.text)
        if (!suggestions) {
            continue;
        }
        newArray.push({
            photo,
            suggestions,
            lowerSuggestions: suggestions.map(s => s.toLocaleLowerCase()),
            lowerWords: suggestions.map(s => getWords(s)).flat(),
        })
    }

    return newArray
}

function setPhotos(photos: PhotoSticker[]) {
    stickersStore.photos = photos
    photoStickersById.clear()
    for (const sticker of photos) {
        photoStickersById.set(getPhotoKey(sticker.photo.owner_id, sticker.photo.id), sticker)
    }

    photoStickersVersion.value++
    initializeStickerSearch(stickersStore.photos)
}

async function loadPhotos(albumIds: number[]) {
    const photos: PhotoSticker[] = []
    for (const album_id of albumIds) {
        try {
            const items: PhotoSticker[] = []
            let offset = 0
            let total = Infinity
            // photos.get отдаёт максимум PHOTOS_GET_COUNT за раз, поэтому ходим страницами, пока альбом не кончится
            while (offset < total) {
                const photosResult = await APIInteractor.callApi({
                    method: 'photos.get',
                    data: {
                        album_id,
                        count: PHOTOS_GET_COUNT,
                        offset,
                    }
                })
                const response = photosResult.response
                total = response.count
                const pageItems: Photo[] = response.items
                items.push(...photosToStickers(pageItems))
                Logger.info(`messenger: loadPhotos album ${album_id}, offset ${offset}, получено ${pageItems.length} из ${total}`)
                if (!pageItems.length) {
                    break
                }

                offset += pageItems.length
            }

            photos.push(...items)
            await photoCache.setPhotos(album_id, items)
        } catch (error) {
            Logger.error(`Failed to load photos for album ${album_id}:`, error)
        }
    }

    setPhotos(photos)
    Logger.info('messenger: update cache photos', photos)
}

/**
 * Извлекает текст из composer input, включая эмодзи
 * VK заменяет эмодзи на <img> элементы, поэтому textContent не работает
 */
function getComposerText(element: HTMLElement | null): string {
    if (!element) return '';
    
    // Получаем innerHTML и извлекаем эмодзи из alt атрибутов
    const innerHTML = element.innerHTML;
    
    // Заменяем <img class="Emoji ..."> на их alt значения (эмодзи)
    const withEmoji = innerHTML.replace(/<img[^>]*class="Emoji[^>]*alt="([^"]*)"[^>]*>/g, '$1');
    
    // Создаём временный элемент для извлечения текста
    const temp = document.createElement('div');
    temp.innerHTML = withEmoji;
    
    return temp.textContent || '';
}

async function showStickers(text: string) {
    if (text === '' || !composerInputInput.value) {
        stickersStore.stickers = []
        return
    }

    // Если найден сonvoComposerEditing, значит пользователь редактирует сообщение и подсказки отображать не нужно.
    if (getConvoComposerEditing()) {
        stickersStore.stickers = []
        return
    }

    await initPhotoStickers()
    if (_initPhotoStickers.value === false) {
        return
    }

    const textLower = text.toLocaleLowerCase()
    const words = getWords(textLower)
    Logger.info(`messenger words`, words)
    stickersStore.stickers = smartStickerSearch(stickersStore.photos, textLower, STICKERS_POPUP_LIMIT);
    // предотвращаем появление стикеров после отправки сообщения
    if (getComposerText(composerInputInput.value) !== text) {
        stickersStore.stickers = []
    }

    Logger.info(`messenger find stickers`, stickersStore.stickers)
    if (!stickersStore.stickers.length) {
        Logger.info('messenger: not found stickers')
        return
    }

    Logger.info('messenger: found stickers', stickersStore.stickers)
}