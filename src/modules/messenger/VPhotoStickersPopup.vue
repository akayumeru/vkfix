<template>
  <teleport v-if="teleportEl" :to="teleportEl">
    <transition>
      <div v-if="stickers.length" class="v-photo-stickers-popup" ref="popupEl">
        <VPhotoSticker
            v-for="sticker in lastStickers"
            :key="sticker.photo.id"
            :sticker="sticker"
            @sendSticker="emit('sendSticker', sticker)"
            @loadFailed="emit('loadFailed', sticker)"
        />
      </div>
    </transition>

    <div
        v-if="isDev"
        :title="`Загружено фотографий-стикеров: ${photos.length}`"
        :style="{
          position: 'absolute',
          right: '0',
          bottom: '0',
          minWidth: '4px',
          minHeight: '4px',
          borderRadius: '50%',
          backgroundColor: photos.length === 0 ? 'red' : 'green'
        }"
    />
  </teleport>
</template>
<script lang="ts" setup>
import {PhotoSticker} from "./types"
import {isDev} from "../../common/consts"
import {computed} from "vue"
import VPhotoSticker from "./VPhotoSticker.vue";

const props = defineProps<{
  photos: PhotoSticker[]
  stickers: PhotoSticker[]
  teleportEl?: HTMLDivElement
}>();

const lastStickers = computed<PhotoSticker[]>((prev) => {
  if (props.stickers.length === 0 && prev?.length > 0) {
    return prev
  }

  return props.stickers;
})

const emit = defineEmits<{
  (e: "sendSticker", sticker: PhotoSticker): void
  (e: "loadFailed", sticker: PhotoSticker): void
}>()

</script>
<style lang="scss">
.v-photo-stickers-popup {
  position: absolute;
  bottom: 100%;
  left: 0;
  height: max-content;
  width: 100%;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 1px;
  z-index: 2;
  pointer-events: none;
  align-content: flex-end;

  & > * {
    pointer-events: all;
  }

  &.v-enter-active,
  &.v-leave-active {
    transition: opacity 0.5s ease
  }

  &.v-enter-from,
  &.v-leave-to {
    opacity: 0
  }
}

.ConvoMain:has(.v-photo-stickers-popup) {
  .ConvoComposer__stickersPanel {
    display: none !important
  }
}
</style>
