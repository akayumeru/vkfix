import {throttle} from "es-toolkit";
import {useMutationObserver} from "@vueuse/core";
import {Logger} from "../classes/Logger";
import {GlobalConfig} from "../GlobalConfig";
import {querySelectorWithTimeout} from "../common/helpers/querySelectorWithTimeout";
import {sleep} from "../common/helpers/sleep";

/**
 * VK переписал фотопросмотрщик на vkit - старого `#pv_box` и глобального
 * `window.Photoview` больше нет, а навигацией по фото управляю сервисы
 * модалки, которые мы достаём из React-файбера подложки вьюера.
 */
interface PhotoViewerServices {
    photoService: {
        photo?: { id: number; owner_id: number; album_id: number };
    };
    listService: {
        context: { type: string; params: string[] };
        total: number;
        isLoading: boolean;
        switchToPhotoAlbum: () => Promise<boolean>;
        load: () => Promise<void>;
    };
    showNext: () => void;
    showPrevious: () => void;
}

interface ReactHook {
    memoizedState: any;
    next: ReactHook | null;
}

interface ReactFiber {
    memoizedState: ReactHook | null;
    return: ReactFiber | null;
}

/**
 * Подложка вьюера - стабильный якорь: у неё есть data-атрибут, в отличие от
 * хешей классов. Сама подложка (`pointer-events: none`) событий колеса не
 * видит, но её родитель - корень модалки, который их видит.
 */
const BACKDROP_SELECTOR = '[data-photo-viewer-backdrop]';

/** Помечаем подложку, чтобы не вешать обработчики повторно при смене фото. */
const PROCESSED_ATTR = 'data-vkfix-viewer';

/** Пункт меню «Ещё» в старом просмотрщике добавлял pvAddons, теперь добавляем мы. */
const COMMUNITY_KEEPER_LABEL = 'Открыть в Хранителе Групп';
const COMMUNITY_KEEPER_ATTR = 'data-vkfix-keeper';
/** Маркер открытого меню «Ещё» и доноры структуры для клона. */
const MENU_MARKER_LABEL = 'Пожаловаться';
const ORIGINAL_ACT_LABEL = 'Открыть оригинал';
const ALBUM_ACT_LABEL = 'Перейти к альбому';

const WHEEL_MIN_DELTA = 20;
/** Для deltaMode в строках/страницах (Firefox) порог - единицы. */
const WHEEL_MIN_DELTA_LINES = 1;
/** Ограничение частоты: guarded только от событий-дублей тачпада, мышке листаем на каждом щелчке. */
const WHEEL_THROTTLE_MS = 60;

/**
 * Ищем сервисы вьюера, поднимаясь по React-файберам от подложки.
 * Компоненты заминимизированы, поэтому ориентируемся на форму объекта
 * сервисов (showNext + listService + photoService), а не на имена.
 */
function findServices(backdrop: HTMLElement): PhotoViewerServices | undefined {
    const fiberKey = Object.keys(backdrop).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) {
        return undefined;
    }

    let fiber: ReactFiber | null = (backdrop as any)[fiberKey];
    for (let depth = 0; fiber && depth < 60; depth++) {
        let hook: ReactHook | null = fiber.memoizedState;
        for (let index = 0; hook && index < 30; index++) {
            const state = hook.memoizedState;
            if (
                state && typeof state === 'object' &&
                typeof state.showNext === 'function' &&
                state.listService && state.photoService
            ) {
                return state as PhotoViewerServices;
            }
            hook = hook.next;
        }
        fiber = fiber.return;
    }

    return undefined;
}

/**
 * Не листаем фото, если пользователь крутит небольшую прокручиваемую панель
 * (комментарии, описание, меню). Контейнер на всю высоту модалки не считаем
 * панелью: у вьюера он всегда чуть переполнен и крутится сам VK вместо нас.
 */
function isInsideScrollableArea(target: EventTarget | null, boundary: Element): boolean {
    let element = target instanceof Element ? target : null;
    const boundaryHeight = boundary.getBoundingClientRect().height;
    while (element && element !== boundary) {
        const { overflowY } = getComputedStyle(element);
        const isPanel = element.getBoundingClientRect().height < boundaryHeight * 0.9;
        if (isPanel && /auto|scroll/.test(overflowY) && element.scrollHeight > element.clientHeight + 4) {
            return true;
        }
        element = element.parentElement;
    }
    return false;
}

function attachPhotoSwitchWheel(listenerTarget: Element, services: PhotoViewerServices) {
    let lastSwitchTime = 0;

    // capture - на случай обработчиков VK внутри модалки, чтобы не зависеть от stopPropagation
    listenerTarget.addEventListener('wheel', (event: WheelEvent) => {
        // ctrl/cmd/alt + колесо - браузерное увеличение, shift + колесо - горизонтальная прокрутка
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
            return;
        }

        const minDelta = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? WHEEL_MIN_DELTA : WHEEL_MIN_DELTA_LINES;
        if (Math.abs(event.deltaY) < minDelta) {
            return;
        }

        if (isInsideScrollableArea(event.target, listenerTarget)) {
            return;
        }

        // гасим прокрутку страницы под открытым вьюером
        event.preventDefault();

        const now = Date.now();
        if (now - lastSwitchTime < WHEEL_THROTTLE_MS) {
            return;
        }
        lastSwitchTime = now;

        try {
            if (event.deltaY > 0) {
                services.showNext();
            } else {
                services.showPrevious();
            }
        } catch (e) {
            Logger.warn('newPhotoViewer: сервисы вьюера отказались переключать фото', { e });
        }
    }, { capture: true });
}

function isSinglePhotoPost(listService: PhotoViewerServices['listService']): boolean {
    try {
        const { type } = listService.context;
        if (type === 'single') {
            return true;
        }

        return type === 'wall' && listService.total <= 1;
    } catch {
        return false;
    }
}

/**
 * ВК открывает пост с одной фотографией в контексте `single` - пролистывать нечего.
 * Встроенный откат на альбом (switchToPhotoAlbum внутри load) срабатывает только
 * когда фото не нашлось в списке, поэтому включаем его сами: переключаем контекст
 * списка на альбом фотографии и перечитываем список.
 */
async function switchSinglePostToAlbum(services: PhotoViewerServices, viewerElement: Element) {
    const listService = services.listService;

    const isViewerAlive = () => viewerElement.isConnected;

    // ждём, пока вьюер загрузит открываемое фото - switchToPhotoAlbum опирается на его данные
    for (let attempt = 0; !services.photoService.photo && attempt < 50; attempt++) {
        await sleep(100);
        if (!isViewerAlive()) {
            return;
        }
    }
    if (!services.photoService.photo) {
        Logger.info('newPhotoViewer: фото не загрузилось, альбом не подключаем');
        return;
    }

    if (!isSinglePhotoPost(listService)) {
        return;
    }

    // на свежем открытии switchToPhotoAlbum может вернуть false, пока данные фото не закешированы - повторяем
    let switched = false;
    for (let attempt = 0; !switched && attempt < 3; attempt++) {
        if (attempt > 0) {
            await sleep(200);
            if (!isViewerAlive()) {
                return;
            }
        }
        switched = await listService.switchToPhotoAlbum();
    }
    if (!switched) {
        Logger.info('newPhotoViewer: switchToPhotoAlbum отказал (альбома нет или контекст сменился)');
        return;
    }

    // дожидаемся завершения текущей загрузки списка и перечитываем его уже как альбом
    for (let attempt = 0; listService.isLoading && attempt < 50; attempt++) {
        await sleep(100);
        if (!isViewerAlive()) {
            return;
        }
    }
    await listService.load();

    Logger.info('newPhotoViewer: переключились на альбом фотографии', listService.context);
}

/** Сервисы последнего открытого вьюера - нужны инжектору меню, который живёт отдельно. */
let lastViewerServices: PhotoViewerServices | undefined;
let keeperMenuWatcherStarted = false;

const normalizeText = (text: string | null): string => (text || '').replace(/\u00a0/g, ' ').trim();

/** Самый глубокий листовой элемент с таким текстом - VK рендерит подписи вложенными span. */
function findLeafByLabel(label: string): HTMLElement | undefined {
    const leaves = [...document.querySelectorAll<HTMLElement>('span, div')].filter(
        (el) => !el.children.length && normalizeText(el.textContent) === label,
    );
    return leaves[leaves.length - 1];
}

/**
 * Добавляет пункт «Открыть в Хранителе Групп» в меню «Ещё» нового вьюера.
 * Пункт дублирует строку «Открыть оригинал» (она ссылка <a>) и берёт иконку
 * у «Перейти к альбому», если она есть. Пункт меню - не React-узел, поэтому
 * при перерисовке меню наблюдатель добавит его заново.
 */
function injectCommunityKeeperAct() {
    const photo = lastViewerServices?.photoService.photo;
    // как и старая версия: только для фото сообществ
    if (!photo || photo.owner_id >= 0) {
        return;
    }

    const marker = findLeafByLabel(MENU_MARKER_LABEL);
    const menu = marker?.closest('[role="dialog"]');
    if (!menu || menu.querySelector(`[${COMMUNITY_KEEPER_ATTR}]`)) {
        return;
    }

    const rows = [...menu.querySelectorAll<HTMLElement>('a, [role="button"]')];
    const originalRow = rows.find(
        (row) => row instanceof HTMLAnchorElement && normalizeText(row.textContent) === ORIGINAL_ACT_LABEL,
    ) as HTMLAnchorElement | undefined;
    if (!originalRow) {
        return;
    }

    const act = originalRow.cloneNode(true) as HTMLAnchorElement;
    act.setAttribute(COMMUNITY_KEEPER_ATTR, 'true');
    act.href = `https://${window.location.host}/app51658481#/photo${photo.owner_id}_${photo.id}`;
    act.target = '_blank';
    act.rel = 'noopener noreferrer';

    for (const labelEl of act.querySelectorAll<HTMLElement>('span')) {
        if (!labelEl.children.length && normalizeText(labelEl.textContent) === ORIGINAL_ACT_LABEL) {
            labelEl.textContent = COMMUNITY_KEEPER_LABEL;
        }
    }

    const albumIcon = rows
        .find((row) => normalizeText(row.textContent) === ALBUM_ACT_LABEL)
        ?.querySelector('svg');
    const actIcon = act.querySelector('svg');
    if (albumIcon && actIcon) {
        actIcon.replaceWith(albumIcon.cloneNode(true));
    }

    originalRow.parentElement?.append(act);
    Logger.info('newPhotoViewer: добавили пункт «' + COMMUNITY_KEEPER_LABEL + '» в меню «Ещё»');
}

/** Меню «Ещё» открывается по клику, поэтому следим за DOM и подставляем пункт при появлении меню. */
function watchCommunityKeeperMenu() {
    if (keeperMenuWatcherStarted) {
        return;
    }
    keeperMenuWatcherStarted = true;

    const tryInject = throttle(injectCommunityKeeperAct, 100);
    useMutationObserver(document.body, tryInject, {childList: true, subtree: true});
    tryInject();
}

/** Дополнения к новому (vkit) фотопросмотрщику: листание колесом и альбом для одиночных фото. */
export async function initNewPhotoViewer() {
    const wheelEnabled = GlobalConfig.Config.get('pvPhotoSwitchWheel') as boolean;
    const albumForSinglePost = GlobalConfig.Config.get('pvPhotoAlbumForSinglePost') as boolean;
    if (!wheelEnabled && !albumForSinglePost) {
        return;
    }

    // На прямой ссылке /photo-... вьюер может открываться дольше
    const isDirectPhotoPage = window.location.pathname.startsWith('/photo');
    const backdrop = await querySelectorWithTimeout<HTMLElement>({
        selectors: BACKDROP_SELECTOR,
        timeout: isDirectPhotoPage ? 5000 : 2000,
    });
    if (!backdrop) {
        Logger.info('newPhotoViewer: вьюер не найден');
        return;
    }

    if (backdrop.hasAttribute(PROCESSED_ATTR)) {
        // обработчики уже зарегистрированы на этот экземпляр вьюера
        return;
    }

    const services = findServices(backdrop);
    if (!services) {
        // сервисов ещё нет - не помечаем подложку, попробуем при следующем изменении z
        Logger.info('newPhotoViewer: не нашли сервисы вьюера в файбере');
        return;
    }

    backdrop.setAttribute(PROCESSED_ATTR, 'true');
    lastViewerServices = services;

    if (GlobalConfig.Config.get('pvPhotoMoreActCommunityKeeper') as boolean) {
        watchCommunityKeeperMenu();
    }

    // сама подложка - фон с pointer-events: none, колесо ловим на корне модалки (её родителе)
    const modalRoot = backdrop.parentElement ?? backdrop;

    if (wheelEnabled) {
        attachPhotoSwitchWheel(modalRoot, services);
    }

    // В мессенджере список фото - история переписки, альбом там не нужен
    if (albumForSinglePost && !window.location.pathname.startsWith('/im')) {
        if (isSinglePhotoPost(services.listService)) {
            switchSinglePostToAlbum(services, backdrop).catch((e) => {
                Logger.warn('newPhotoViewer: не удалось переключиться на альбом', { e });
            });
        }
    }
}
