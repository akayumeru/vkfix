// ==UserScript==
// @name VK Fix
// @description Скрипт для улучшения интерфейса ВКонтакте
// @author Ivan Petrov (LazyTechwork)
// @contributors Ivan Mel (ivanmem)
// @license MIT
// @version 2.1.1
// @include https://vk.com/*
// @include https://vk.ru/*
// @include https://cargo.tau.vk.ru/*
// @grant GM_getValue
// @grant GM_setValue
// @grant GM_addStyle
// @grant unsafeWindow
// ==/UserScript==

import styles from './modules/styles';
import {mutationHandler} from './modules/mutations/mutationHandler';
import {GlobalConfig} from './GlobalConfig';
import {LocationState} from './classes/LocationState';
import {pageScanner} from './modules/pageScanner';
import {pvAddons} from './modules/pvAddons';
import {Logger} from "./classes/Logger";

import {querySelectorWithTimeout} from "./common/helpers/querySelectorWithTimeout";
import {appActions} from "./modules/appActions";
import {messenger} from "./modules/messenger/messenger";
import {initSwitchTextLayout} from './modules/switchTextLayout';
import {initGroupInfoTeleport} from './modules/groupInfoTeleport';
import {initPhotoRowLinks} from './modules/photoRowLinks';
import {createApp, h} from 'vue';
import VConfigPopup from './modules/config/VConfigPopup.vue';
import VConfigButton from './modules/config/VConfigButton.vue';

(async function (window) { // Используем замыкание для запуска нашего скрипта
    let w = window;

    if (w.self != w.top) {
        return;
    }

    // [4] дополнительная проверка наряду с @include
    if (/^https:\/\/(vk|cargo.tau.vk)\.(com|ru)\//.test(w.location.href)) {
        Logger.log('VK Fix запущен');

        // Добавляем кнопку настроек в верхнее меню
        const settings_link = await querySelectorWithTimeout({selectors: '#top_settings_link', timeout: 5000});
        if (settings_link?.parentNode) {
            // Создаём Vue приложение для конфига
            const configAppContainer = document.createElement('div');
            const configApp = createApp(VConfigPopup);
            const configInstance = configApp.mount(configAppContainer);
            document.body.appendChild(configAppContainer);

            // Создаём кнопку через Vue
            const buttonContainer = document.createElement('div');
            settings_link.parentNode.insertBefore(buttonContainer, settings_link.nextSibling);

            const buttonApp = createApp(VConfigButton, {
                onOpen: () => {
                    Logger.log('VK Fix Config: клик по кнопке');
                    (configInstance as InstanceType<typeof VConfigPopup>).open();
                }
            });
            buttonApp.mount(buttonContainer);
        }

        const initModules = () => {
            styles(); // Инъекция стилей
            pageScanner(); // Инициализируем сканер страницы
            mutationHandler(); // Регистрируем модуль слежения за мутациями
            pvAddons(); // Инициализируем дополнения к просмотрщику фото

            appActions(); // Инициализируем дополнения к приложениям
            messenger(); // Инициализируем дополнения к мессенджеру
            initSwitchTextLayout(); // Инициализируем функцию переключения раскладки
            initGroupInfoTeleport(); // Инициализируем телепортацию информации о группе
            initPhotoRowLinks(); // Чиним ссылки на фото и добавляем подсказки фото-стикеров
            // Слежение за изменениями в URL
            LocationState.init();
        };

        // Проверяем текущее состояние загрузки
        if (document.readyState === 'loading') {
            // Документ ещё загружается - ждём load
            const onLoad = () => {
                initModules();
                window.removeEventListener('load', onLoad);
            };
            window.addEventListener('load', onLoad);
        } else {
            // Документ уже загружен (interactive или complete)
            initModules();
        }
    }
})(window);
