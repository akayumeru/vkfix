import {watch} from "vue";
import {useDevicePixelRatio, useMutationObserver} from "@vueuse/core";
import {throttle} from "es-toolkit";
import {Logger} from "../classes/Logger";
import {
    getPhotoSticker,
    getPhotoStickerByImageUrl,
    initPhotoStickers,
    photoStickersVersion
} from "./messenger/messenger";
import {getPhotoImageKey, getPhotoStickerHref} from "./messenger/photoStickerUtils";

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
const PICKER_ITEM_SELECTOR = '[data-testid="posting_photo_picker_photos_item"]';

const PICKER_IMG_SELECTOR = `${PICKER_ITEM_SELECTOR} img[src]`;

/**
 * Помечаем обработанные ссылки версией справочника стикеров:
 * когда стикеры догрузятся, версия изменится и мы проставим подсказки повторно.
 */
const PROCESSED_ATTR = 'data-vkfix-photo-row';

/** Ширина уже запрошенной миниатюры: по ней видно, что после зума нужна картинка покрупнее. */
const THUMB_WIDTH_ATTR = 'data-vkfix-thumb-width';

/** При зуме браузера меняется плотность пикселей, а не размер блока, поэтому следим именно за ней. */
const {pixelRatio} = useDevicePixelRatio();

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

        const version = `${photoStickersVersion.value}:${pixelRatio.value}`;
        for (const imgEl of imgEls) {
            if (imgEl.getAttribute(PROCESSED_ATTR) === version) {
                continue;
            }

            imgEl.setAttribute(PROCESSED_ATTR, version);
            processPhotoRow(imgEl);
        }

        for (const imgEl of pickerImgEls) {
            if (imgEl.getAttribute(PROCESSED_ATTR) === version) {
                continue;
            }

            imgEl.setAttribute(PROCESSED_ATTR, version);
            processPickerImg(imgEl);
        }
    }, 100);

    useMutationObserver(document.body, processAll, {childList: true, subtree: true});
    watch([photoStickersVersion, pixelRatio], processAll);
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
    const rawThumb = linkEl.getAttribute('onclick')?.match(THUMB_REGEX)?.[1];
    if (!rawThumb) {
        Logger.info('photoRowLinks: в onclick нет ссылки на миниатюру', linkEl.getAttribute('onclick'));
        return;
    }

    const thumb = resizeThumbUrl(rawThumb.replace(/\\\//g, '/'), imgEl);
    if (!thumb) {
        return;
    }

    Logger.info('photoRowLinks: укрупняем миниатюру', thumb);
    imgEl.style.backgroundImage = `url("${thumb.url}")`;
    imgEl.setAttribute(THUMB_WIDTH_ATTR, String(thumb.width));
}

/**
 * В выборе фотографии для записи нет ни ссылки, ни id фотографии, поэтому стикер ищем
 * по имени файла картинки: у всех размеров одной фотографии оно одинаковое.
 */
function processPickerImg(imgEl: HTMLImageElement) {
    const sticker = getPhotoStickerByImageUrl(imgEl.src);
    if (!sticker) {
        Logger.info('photoRowLinks: фотография из выбора не нашлась среди стикеров', {
            imageKey: getPhotoImageKey(imgEl.src),
            src: imgEl.src,
        });
    }

    const itemEl = imgEl.closest<HTMLElement>(PICKER_ITEM_SELECTOR) ?? imgEl;
    const title = sticker?.suggestions[0];
    if (title && itemEl.title !== title) {
        itemEl.title = title;
    }

    upgradePickerThumbnail(imgEl);
}

/** В выборе фотографии для записи превью - картинка со ссылкой того же вида, только в src. */
function upgradePickerThumbnail(imgEl: HTMLImageElement) {
    const thumb = resizeThumbUrl(imgEl.src, imgEl);
    if (!thumb) {
        return;
    }

    Logger.info('photoRowLinks: укрупняем миниатюру в выборе фотографии', thumb);
    imgEl.src = thumb.url;
    imgEl.setAttribute(THUMB_WIDTH_ATTR, String(thumb.width));
}

/**
 * Подставляет в ссылку на миниатюру размер под фактический блок: доступные размеры
 * перечислены в параметре `as`, текущий задаётся параметром `cs`.
 * Возвращает undefined, когда запрашивать нечего: картинка нужного размера уже загружена.
 */
function resizeThumbUrl(thumbUrl: string, imgEl: HTMLElement): {url: string, width: number, targetWidth: number} | undefined {
    const elementWidth = imgEl.offsetWidth || Number(imgEl.getAttribute('width'));
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

    const targetWidth = elementWidth * pixelRatio.value;
    const width = widths.find(availableWidth => availableWidth >= targetWidth) ?? widths.at(-1);

    // после отдаления ширина нужна меньше, но перекачивать картинку ради этого незачем
    if (Number(imgEl.getAttribute(THUMB_WIDTH_ATTR)) >= width) {
        return;
    }

    const url = /[?&]cs=/.test(thumbUrl)
        ? thumbUrl.replace(/([?&]cs=)[^&]*/, `$1${width}x0`)
        : `${thumbUrl}&cs=${width}x0`;

    return {url, width, targetWidth};
}
