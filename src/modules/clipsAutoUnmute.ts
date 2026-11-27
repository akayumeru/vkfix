import {useMutationObserver} from "@vueuse/core";
import {throttle} from "es-toolkit";
import {Logger} from "../classes/Logger";
import {GlobalConfig} from "../GlobalConfig";

/** Подпись кнопки, когда звук выключен. У включённого звука подпись другая - "Выключить звук". */
const UNMUTE_LABEL = 'Включить звук';

/** Жмём кнопку только один раз на элемент, иначе перебьём ручное выключение звука. */
const PROCESSED_ATTR = 'data-vkfix-unmuted';

/**
 * VK убрал data-testid у кнопки звука в обновлённом плеере клипов,
 * ищем кнопку по её доступному имени - подписи внутри кнопки или aria-label.
 */
function findUnmuteButtons(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('button')].filter((buttonEl) => {
        const name = (buttonEl.getAttribute('aria-label') || buttonEl.textContent || '')
            .replace(/\u00a0/g, ' ')
            .trim();
        return name === UNMUTE_LABEL;
    });
}

/** Клипы открываются со звуком, выключенным самим VK - включаем его за пользователя. */
export function initClipsAutoUnmute() {
    if (!GlobalConfig.Config.get('clipsAutoUnmute')) {
        return;
    }

    const unmuteAll = throttle(() => {
        for (const buttonEl of findUnmuteButtons()) {
            if (buttonEl.hasAttribute(PROCESSED_ATTR)) {
                continue;
            }

            buttonEl.setAttribute(PROCESSED_ATTR, '');
            buttonEl.click();
            Logger.info('clipsAutoUnmute: включили звук', buttonEl);
        }
    }, 100);

    useMutationObserver(document.body, unmuteAll, {childList: true, subtree: true});
    unmuteAll();
}
