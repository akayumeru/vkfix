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
        const imgEls = document.querySelectorAll<HTMLElement>('.photo_row_img');
        if (!imgEls.length) {
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
    if (!elementWidth) {
        return;
    }

    const rawThumb = linkEl.getAttribute('onclick')?.match(THUMB_REGEX)?.[1];
    if (!rawThumb) {
        Logger.info('photoRowLinks: в onclick нет ссылки на миниатюру', linkEl.getAttribute('onclick'));
        return;
    }

    const thumbUrl = rawThumb.replace(/\\\//g, '/');
    const widths = thumbUrl.match(/[?&]as=([^&]+)/)?.[1]
        .split(',')
        .map(size => Number(size.split('x')[0]));
    if (!widths?.length) {
        Logger.info('photoRowLinks: у миниатюры нет списка размеров', thumbUrl);
        return;
    }

    const targetWidth = elementWidth * (window.devicePixelRatio || 1);
    const width = widths.find(availableWidth => availableWidth >= targetWidth) ?? widths.at(-1);
    const url = /[?&]cs=/.test(thumbUrl)
        ? thumbUrl.replace(/([?&]cs=)[^&]*/, `$1${width}x0`)
        : `${thumbUrl}&cs=${width}x0`;

    const background = `url("${url}")`;
    if (imgEl.style.backgroundImage === background) {
        return;
    }

    Logger.info('photoRowLinks: укрупняем миниатюру', {elementWidth, targetWidth, width, url});
    imgEl.style.backgroundImage = background;
}
