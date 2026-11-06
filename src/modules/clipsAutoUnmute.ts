import {useMutationObserver} from "@vueuse/core";
import {throttle} from "es-toolkit";
import {Logger} from "../classes/Logger";
import {GlobalConfig} from "../GlobalConfig";

const MUTE_BUTTON_SELECTOR = 'button[data-testid="clips-controls-mute-button"]';

/** Подпись кнопки, когда звук выключен. У включённого звука подпись другая - "Выключить звук". */
const UNMUTE_LABEL = 'Включить звук';

/** Жмём кнопку только один раз на элемент, иначе перебьём ручное выключение звука. */
const PROCESSED_ATTR = 'data-vkfix-unmuted';

/** Клипы открываются со звуком, выключенным самим VK - включаем его за пользователя. */
export function initClipsAutoUnmute() {
    if (!GlobalConfig.Config.get('clipsAutoUnmute')) {
        return;
    }

    const loggedButtons = new WeakSet<HTMLButtonElement>();

    const unmuteAll = throttle(() => {
        for (const buttonEl of document.querySelectorAll<HTMLButtonElement>(MUTE_BUTTON_SELECTOR)) {
            if (buttonEl.hasAttribute(PROCESSED_ATTR)) {
                continue;
            }

            const label = buttonEl.textContent?.trim();
            // логируем каждую кнопку один раз: наблюдатель срабатывает на каждом кадре проигрывания
            if (!loggedButtons.has(buttonEl)) {
                loggedButtons.add(buttonEl);
                Logger.info('clipsAutoUnmute: найдена кнопка звука', {label, buttonEl});
            }

            if (label !== UNMUTE_LABEL) {
                continue;
            }

            buttonEl.setAttribute(PROCESSED_ATTR, '');
            buttonEl.click();
            Logger.info('clipsAutoUnmute: включили звук', buttonEl.textContent?.trim());
        }
    }, 100);

    useMutationObserver(document.body, unmuteAll, {childList: true, subtree: true});
    unmuteAll();
}
