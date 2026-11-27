import {GlobalConfig} from '../GlobalConfig';
import {Logger} from "../classes/Logger";
import {querySelectorWithTimeout} from "../common/helpers/querySelectorWithTimeout";
import {initNewPhotoViewer} from "./newPhotoViewer";

interface PVAddonsContext {
    pvPhoto: HTMLDivElement;
    pvBox: HTMLElement;
    pvBottomInfo: HTMLDivElement;
}

export async function pvAddons() {
    // Новый (vkit) фотопросмотрщик - вызываем первым делом
    initNewPhotoViewer().catch((e) => {
        Logger.warn("Ошибка в initNewPhotoViewer.", {e});
    });

    const isPvExpand = GlobalConfig.Config.get('pvExpand') as boolean;
    const pvPhotoSwitchWheel = GlobalConfig.Config.get('pvPhotoSwitchWheel') as boolean;
    const pvPhotoMoreActCommunityKeeper = GlobalConfig.Config.get('pvPhotoMoreActCommunityKeeper') as boolean;
    const pvPhotoMoreActAlbum = GlobalConfig.Config.get('pvPhotoMoreActAlbum') as boolean;
    if (!isPvExpand && !pvPhotoSwitchWheel && !pvPhotoMoreActCommunityKeeper && !pvPhotoMoreActAlbum) {
        return;
    }

    // На страницах /photo-... (прямая ссылка на фото в альбоме) просмотрщик может загружаться дольше
    const isDirectPhotoPage = window.location.pathname.startsWith('/photo');
    const timeout = isDirectPhotoPage ? 5000 : 2000;
    
    Logger.info('pvAddons: ищем pv_box', {isDirectPhotoPage, timeout, pathname: window.location.pathname});
    
    const pvBox = await querySelectorWithTimeout<HTMLDivElement>({selectors: '#pv_box', timeout});
    if (!pvBox) {
        Logger.info('pv_box not found', {isDirectPhotoPage, timeout});
        return;
    }
    
    Logger.info('pvAddons: pv_box найден, ищем остальные элементы');

    const pvBottomInfo = await querySelectorWithTimeout<HTMLDivElement>({
        element: pvBox,
        selectors: '.pv_bottom_info'
    });
    if (!pvBottomInfo) {
        Logger.info('pv_bottom_info not found');
        return;
    }

    const pvPhoto = await querySelectorWithTimeout<HTMLDivElement>({
        element: pvBox,
        selectors: `#pv_photo`
    });
    if (!pvPhoto) {
        Logger.info('pv_photo not found');
        return;
    }

    const context: PVAddonsContext = {
        pvPhoto, pvBox, pvBottomInfo,
    };
    if (isPvExpand) {
        try {
            pvExpand(context);
        } catch (e: any) {
            Logger.warn("Ошибка в expand.", {e});
        }
    }

    if (pvPhotoSwitchWheel) {
        try {
            photoSwitchWheel(context);
        } catch (e: any) {
            Logger.warn("Ошибка в photoSwitchWheel.", {e});
        }
    }

    if (pvPhotoMoreActCommunityKeeper || pvPhotoMoreActAlbum) {
        try {
            photoMoreActs(context);
        } catch (e: any) {
            Logger.warn("Ошибка в photoMoreActs.", {e});
        }
    }
}

let pvExpandClickValue: boolean = undefined;

function pvExpand({pvPhoto, pvBottomInfo,}: PVAddonsContext) {
    const buttonId = 'pv_expand_photo';
    if (document.getElementById(buttonId)) {
        return;
    }

    const pvBottomActions = pvBottomInfo.querySelector('.pv_bottom_actions') as HTMLDivElement | undefined;
    if (!pvBottomActions) {
        Logger.info('pv_bottom_actions not found');
        return;
    }

    const prependDivider = () => {
        const dividerEl = document.createElement('span');
        dividerEl.classList.add('divider');
        pvBottomActions.prepend(dividerEl);
    };

    prependDivider();
    const expandBtn = document.createElement('a');
    expandBtn.id = buttonId;
    expandBtn.style.setProperty('min-width', '68px');
    expandBtn.style.setProperty('display', 'inline-block');

    let prevObserver: MutationObserver | undefined = undefined;
    let stateExpand = false;
    // В этих переменных храним изначальное значение, которое задаёт сам VK.
    // После отмены сужения задаём их обратно.
    let prevWidth: any = undefined;
    let prevHeight: any = undefined;

    const switchExpand = async (value = !stateExpand) => {
        prevObserver?.disconnect();
        prevObserver = undefined;
        stateExpand = value;

        const imgExpand = (img: HTMLImageElement) => {
            img.style.setProperty('width', '100%', 'important');
            img.style.setProperty('height', '100%', 'important');
            img.style.setProperty('object-fit', 'contain', 'important');
            expandBtn.innerHTML = "Сузить";
            stateExpand = true;
        };

        const imgRemoveExpand = (img: HTMLImageElement) => {
            if (img.style.width !== '100%') {
                prevWidth = img.style.width;
                prevHeight = img.style.height;
            } else {
                img.style.removeProperty('width');
                img.style.removeProperty('height');
                if (prevWidth && prevHeight) {
                    img.style.setProperty('width', prevWidth);
                    img.style.setProperty('height', prevHeight);
                }
            }

            img.style.removeProperty('object-fit');
            expandBtn.innerHTML = "Расширить";
            stateExpand = false;
        }

        const applyChanges = async () => {
            const img = await querySelectorWithTimeout<HTMLImageElement>({
                element: pvPhoto,
                selectors: `img`
            });
            if (!img) {
                Logger.info('img not found');
                return;
            }

            value ? imgExpand(img) : imgRemoveExpand(img);
        };

        await applyChanges();
        const observer = new MutationObserver(applyChanges);
        observer.observe(pvPhoto, {childList: true});
        prevObserver = observer;
    };

    expandBtn.addEventListener('click', async () => {
        await switchExpand();
        pvExpandClickValue = stateExpand;
    });
    pvBottomActions.prepend(expandBtn);
    if (pvExpandClickValue !== undefined) {
        switchExpand(pvExpandClickValue);
        return;
    }

    if (!stateExpand && GlobalConfig.Config.get(window.screenLeft < 0 ? 'pvExpandLeftMonitorDefault' : 'pvExpandRightMonitorDefault')) {
        switchExpand(true);
        return
    }

    switchExpand(false);
}

function photoSwitchWheel({pvBox}: PVAddonsContext) {
    const pvImageWrap = pvBox.querySelector('.pv_image_wrap') as HTMLDivElement | undefined;
    if (!pvImageWrap) {
        Logger.info('pvImageWrap not found');
        return;
    }

    if (pvImageWrap.dataset.photoSwitchWheel === 'true') {
        // событие уже зарегистрировано
        return;
    }

    const win = document.defaultView as any;
    pvImageWrap.dataset.photoSwitchWheel = 'true';
    pvImageWrap.addEventListener('wheel', (e) => {
        const isNext = e.deltaY > 0;
        const isPrev = !isNext;
        if (isNext) {
            win.Photoview.show(false, win.cur.pvIndex + 1);
        }

        if (isPrev) {
            win.Photoview.show(false, win.cur.pvIndex - 1);
        }
    })
}

let initPhotoMoreActs = false
let abortControllerPhotoMoreActs = new AbortController()

function photoMoreActs({pvBox}: PVAddonsContext) {
    const pvImageWrap = pvBox.querySelector('.pv_image_wrap') as HTMLDivElement | undefined;
    if (!pvImageWrap) {
        Logger.info('pvImageWrap not found');
        return;
    }

    Logger.info("photoMoreActs: pvImageWrap найден, ищем дальше");

    const pvActionsMore = pvBox.querySelector<HTMLButtonElement>('.pv_actions_more')
    if (!pvActionsMore) {
        Logger.info('pvActionsMore not found');
        return
    }

    Logger.info("photoMoreActs: pvActionsMore найден, ищем дальше");

    const pvPhotoMoreActCommunityKeeper = GlobalConfig.Config.get('pvPhotoMoreActCommunityKeeper') as boolean;
    const pvPhotoMoreActAlbum = GlobalConfig.Config.get('pvPhotoMoreActAlbum') as boolean;
    const actNames: ('pvPhotoMoreActCommunityKeeper' | 'pvPhotoMoreActAlbum')[] = []
    if (pvPhotoMoreActCommunityKeeper) {
        actNames.push('pvPhotoMoreActCommunityKeeper')
    }

    if (pvPhotoMoreActAlbum) {
        actNames.push('pvPhotoMoreActAlbum')
    }


    if (!initPhotoMoreActs && actNames.length) {
        const style = document.createElement('style');
        document.head.appendChild(style);
        style.sheet.insertRule(`.pv_more_act_vkfix::before { background-position: 0 -60px; }`, 0);
        initPhotoMoreActs = true
    }

    abortControllerPhotoMoreActs.abort()
    abortControllerPhotoMoreActs = new AbortController()
    const signal = abortControllerPhotoMoreActs.signal

    const registerMoreAct = async (name: 'pvPhotoMoreActCommunityKeeper' | 'pvPhotoMoreActAlbum', textContent: string, href: string) => {
        if (!cur.pvCurPhoto.id.startsWith('-')) {
            Logger.info('registerMoreAct: для юзерских фото не добавляем ничего')
            return;
        }
        if (pvActionsMore.querySelector(`#${name}`)) {
            Logger.info("registerMoreAct: уже добавлено")
            return
        }

        const pvMoreActDownload = await querySelectorWithTimeout<HTMLLinkElement>({
            selectors: '#pv_more_act_download',
            element: pvBox,
            timeout: 1000,
            signal,
        }).catch(() => undefined)

        if (!pvMoreActDownload) {
            Logger.info('registerMoreAct: pvMoreActDownload not found');
            return
        }

        if (pvActionsMore.querySelector(`#${name}`)) {
            Logger.info(`registerMoreAct: pvActionsMore > ${name} not found`);
            return
        }

        signal.throwIfAborted()

        const pvMoreAct = pvMoreActDownload.cloneNode() as HTMLLinkElement
        pvMoreAct.id = name
        pvMoreAct.textContent = textContent
        pvMoreAct.href = href
        pvMoreAct.classList.add('pv_more_act_vkfix')
        pvMoreActDownload.parentElement.append(pvMoreAct)
        Logger.info(`registerMoreAct: ${name} добавлена`);

        const pvMoreActsTt = pvBox.querySelector<HTMLDivElement>('#pv_more_acts_tt')
        if (pvMoreActsTt) {
            pvMoreActsTt.style.top = `${parseInt(pvMoreActsTt.style.top, 10) - 32}px`;
        }
    }

    const registerMoreActs = async () => {
        if (pvPhotoMoreActCommunityKeeper) {
            await registerMoreAct('pvPhotoMoreActCommunityKeeper', 'Открыть в Хранителе Групп', `https://${window.location.host}/app51658481#/photo${cur.pvCurPhoto.id}`)
        }

        const isPhotoPath = window.location.pathname.startsWith('/photo-')
        if (pvPhotoMoreActAlbum && !isPhotoPath) {
            await registerMoreAct('pvPhotoMoreActAlbum', 'Открыть в альбоме', `https://${window.location.host}/photo${cur.pvCurPhoto.id}`)
        }
    }

    pvActionsMore.addEventListener('mouseenter', registerMoreActs, {
        capture: true,
        signal,
    })
}

declare const cur: any