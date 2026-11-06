import {watch} from "vue";
import {useMutationObserver} from "@vueuse/core";
import {throttle} from "es-toolkit";
import {Logger} from "../classes/Logger";
import {getPhotoSticker, initPhotoStickers, photoStickersVersion} from "./messenger/messenger";
import {getPhotoStickerHref} from "./messenger/photoStickerUtils";

/** Из ссылки вида `photo171882202_457316876` или `/photo171882202_457316876?list=...` берём владельца и id фото. */
const PHOTO_HREF_REGEX = /photo(-?\d+)_(\d+)/;

/**
 * Ссылка на миниатюру в onclick: у неё нет подписи, зато есть список доступных
 * размеров в `as=` и текущий размер в `cs=`, который можно поднять.
 */
const THUMB_REGEX = /"thumb_[a-z]":"(.*?)"/;

/** Старый выбор фотографии: превью лежит фоном у блока внутри ссылки. */
const PHOTO_ROW_SELECTOR = '.photo_row_img';

/** Выбор фотографии в записи: превью - обычная картинка, ссылки и id фотографии рядом нет. */
const PICKER_IMG_SELECTOR = '[data-testid="posting_photo_picker_photos_item"] img[src]';

/**
 * Помечаем обработанные ссылки версией справочника стикеров:
 * когда стикеры догрузятся, версия изменится и мы проставим подсказки повторно.
 */
const PROCESSED_ATTR = 'data-vkfix-photo-row';

/**
 * VK в мессенджере отдаёт относительную ссылку `photo171882202_457316876`,
 * и браузер превращает её в `/im/convo/photo171882202_457316876`.
 * Чиним ссылку и заодно показываем ту же подсказку, что и у фото-стикеров.
 */
export function initPhotoRowLinks() {
    let isStickersRequested = false;

    const processAll = throttle(() => {
        const imgEls = document.querySelectorAll<HTMLElement>(PHOTO_ROW_SELECTOR);
        const pickerImgEls = document.querySelectorAll<HTMLImageElement>(PICKER_IMG_SELECTOR);
        if (!imgEls.length && !pickerImgEls.length) {
            return;
        }

        // грузим стикеры только когда фото на странице действительно есть, а не на каждой странице VK
        if (!isStickersRequested) {
            isStickersRequested = true;
            initPhotoStickers().then();
        }

        const version = String(photoStickersVersion.value);
        for (const imgEl of imgEls) {
            if (imgEl.getAttribute(PROCESSED_ATTR) === version) {
                continue;
            }

            imgEl.setAttribute(PROCESSED_ATTR, version);
            processPhotoRow(imgEl);
        }

        for (const imgEl of pickerImgEls) {
            upgradePickerThumbnail(imgEl);
        }
    }, 100);

    useMutationObserver(document.body, processAll, {childList: true, subtree: true});
    watch(photoStickersVersion, processAll);
    processAll();
}

function processPhotoRow(imgEl: HTMLElement) {
    const linkEl = imgEl.closest('a');
    const match = linkEl?.getAttribute('href')?.match(PHOTO_HREF_REGEX);
    if (!match) {
        return;
    }

    const ownerId = Number(match[1]);
    const photoId = Number(match[2]);
    const sticker = getPhotoSticker(ownerId, photoId);
    const href = sticker
        ? getPhotoStickerHref(sticker)
        : `https://${window.location.host}/photo${ownerId}_${photoId}`;

    if (linkEl.href !== href) {
        Logger.info('photoRowLinks: чиним ссылку', linkEl.href, '->', href);
        linkEl.href = href;
    }

    // title вешаем на ссылку, а не на .photo_row_img: поверх него лежат фон и чекбокс,
    // курсор попадает в них, и подсказку браузер ищет вверх по предкам
    const title = sticker?.suggestions[0];
    if (title && linkEl.title !== title) {
        linkEl.title = title;
    }

    upgradeThumbnail(imgEl, linkEl);
}

/** VK отдаёт превью в 130x98 и на экране они мыльные - просим размер под фактический блок. */
function upgradeThumbnail(imgEl: HTMLElement, linkEl: HTMLAnchorElement) {
    const elementWidth = imgEl.offsetWidth;
    const rawThumb = linkEl.getAttribute('onclick')?.match(THUMB_REGEX)?.[1];
    if (!rawThumb) {
        Logger.info('photoRowLinks: в onclick нет ссылки на миниатюру', linkEl.getAttribute('onclick'));
        return;
    }

    const url = resizeThumbUrl(rawThumb.replace(/\\\//g, '/'), elementWidth);
    if (!url) {
        return;
    }

    const background = `url("${url}")`;
    if (imgEl.style.backgroundImage === background) {
        return;
    }

    Logger.info('photoRowLinks: укрупняем миниатюру', {elementWidth, url});
    imgEl.style.backgroundImage = background;
}

/** В выборе фотографии для записи превью - картинка со ссылкой того же вида, только в src. */
function upgradePickerThumbnail(imgEl: HTMLImageElement) {
    const elementWidth = imgEl.offsetWidth || Number(imgEl.getAttribute('width'));
    const url = resizeThumbUrl(imgEl.src, elementWidth);
    if (!url || url === imgEl.src) {
        return;
    }

    Logger.info('photoRowLinks: укрупняем миниатюру в выборе фотографии', {elementWidth, url});
    imgEl.src = url;
}

/**
 * Подставляет в ссылку на миниатюру размер под фактический блок: доступные размеры
 * перечислены в параметре `as`, текущий задаётся параметром `cs`.
 */
function resizeThumbUrl(thumbUrl: string, elementWidth: number): string | undefined {
    if (!elementWidth) {
        return;
    }

    const widths = thumbUrl.match(/[?&]as=([^&]+)/)?.[1]
        .split(',')
        .map(size => Number(size.split('x')[0]));
    if (!widths?.length) {
        Logger.info('photoRowLinks: у миниатюры нет списка размеров', thumbUrl);
        return;
    }

    const targetWidth = elementWidth * (window.devicePixelRatio || 1);
    const width = widths.find(availableWidth => availableWidth >= targetWidth) ?? widths.at(-1);

    return /[?&]cs=/.test(thumbUrl)
        ? thumbUrl.replace(/([?&]cs=)[^&]*/, `$1${width}x0`)
        : `${thumbUrl}&cs=${width}x0`;
}
