<template>
    <a class="v-photo-sticker" tabindex="-1" :href="getPhotoStickerHref(sticker)">
    <div :key="sticker.photo.id" class="v-photo-sticker-text">
      {{ sticker.suggestions[0] }}
    </div>
    <img
        ref="imgEl"
        class="v-photo-sticker-img"
        :class="{'v-photo-sticker-img--placeholder': !isLoaded}"
        tabindex="0"
        :src="imgSrc"
        :alt="isLoaded ? sticker.photo.text : ''"
        :title="sticker.suggestions[0]"
        @dragstart.prevent
        @click.prevent.stop="emit('sendSticker', sticker)"
        @load="isLoading = false"
        @error="onError"
    />
  </a>
</template>
<script lang="ts" setup>
import {PhotoSticker} from "./types";
import {computed, ref, useTemplateRef, watch} from "vue";
import {useElementSize, useTimeoutFn} from "@vueuse/core";
import {getPhotoStickerHref, getPhotoStickerUrl} from "./photoStickerUtils";
import {Logger} from "../../classes/Logger";

const props = defineProps<{
  sticker: PhotoSticker;
}>();

const emit = defineEmits<{
  (e: "sendSticker", sticker: PhotoSticker): void;
  (e: "loadFailed", sticker: PhotoSticker): void;
}>();

/** Сколько раз пробуем загрузить картинку: VK периодически отдаёт ошибку на ровном месте. */
const MAX_LOAD_ATTEMPTS = 3;

/** Пауза перед повтором, растёт с номером попытки. */
const RETRY_DELAY_MS = 700;

/** Ширина чёрной плашки, пока картинки нет: настоящей ширины мы ещё не знаем. */
const PLACEHOLDER_WIDTH = '100px';

const imgEl = useTemplateRef("imgEl");

const photoUrl = computed(() => getPhotoStickerUrl(props.sticker));

const isLoading = ref(true);
const isError = ref(false);
const attempt = ref(0);
// undefined, а не пустая строка: пустой src браузер трактует как ссылку на саму страницу
const imgSrc = ref<string | undefined>(photoUrl.value);

// снятие src само по себе стреляет error - пока флаг поднят, такую ошибку не считаем попыткой
const isRetrying = ref(false);

// снимаем src и возвращаем его же: иначе браузер не повторит запрос за той же картинкой
const {start: startRetry, stop: stopRetry} = useTimeoutFn(
    () => {
      isRetrying.value = false;
      imgSrc.value = photoUrl.value;
    },
    () => RETRY_DELAY_MS * attempt.value,
    {immediate: false}
);

const isLoaded = computed(() => !isLoading.value && !isError.value);

const {width: imgWidth} = useElementSize(imgEl);

const textWidth = computed(() => {
  return isLoaded.value ? imgWidth.value + "px" : PLACEHOLDER_WIDTH;
});

watch(photoUrl, (photoUrl) => {
  stopRetry();
  isRetrying.value = false;
  isLoading.value = true;
  isError.value = false;
  attempt.value = 0;
  imgSrc.value = photoUrl;
})

function onError() {
  // снятый src и повторная ошибка на уже провалившемся фото новых попыток не стоят
  if (isRetrying.value || isError.value) {
    return;
  }

  Logger.error('VPhotoSticker: фото не загрузилось', {
    url: photoUrl.value,
    attempt: attempt.value,
    photo: props.sticker.photo,
    suggestion: props.sticker.suggestions[0],
  });

  if (attempt.value < MAX_LOAD_ATTEMPTS) {
    attempt.value++;
    isRetrying.value = true;
    imgSrc.value = undefined;
    startRetry();
    return;
  }

  isError.value = true;
  isLoading.value = false;
  // без src браузер не рисует значок битой картинки - остаётся ровная чёрная плашка
  imgSrc.value = undefined;
  emit('loadFailed', props.sticker);
}

</script>
<style lang="scss">
.v-photo-sticker {
  position: relative;
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  justify-content: flex-end;
  transition: all 0.2s ease;

  .v-photo-sticker-text {
    color: #fff;
    // непрозрачный фон: сквозь полупрозрачный просвечивала переписка
    background-color: #000;
    white-space: normal;
    word-break: auto-phrase;
    padding: 4px;
    margin-bottom: -1px;
    text-align: left;
    font-size: 14px;
    line-height: 1.3;
    width: v-bind(textWidth);
    // ровно 4 строки + вертикальные padding'и, иначе последняя строка обрезается пополам
    max-height: calc(4 * 1.3em + 8px);
    box-sizing: border-box;
    overflow: auto;
    outline: 1px solid rgba(255, 255, 255, 0.67);
    border-radius: 8px 8px 0 0;
    outline-offset: -1px;
  }

  .v-photo-sticker-img {
    position: relative;
    height: 99px;
    outline: 1px solid rgba(255, 255, 255, 0.67);
    outline-offset: -1px;
    border-radius: 0 0 8px 8px;
    object-fit: cover;
    cursor: pointer;
    background-color: #000;
    // alt не показываем: вместо него чёрная плашка
    font-size: 0;

    // пока картинки нет, держим ширину плашки с текстом, иначе стикер схлопнется
    &--placeholder {
      width: v-bind(PLACEHOLDER_WIDTH);
    }

    &:focus {
      outline: var(--vkui_internal--outline);
      outline-offset: -2px;
    }
  }
}
</style>
