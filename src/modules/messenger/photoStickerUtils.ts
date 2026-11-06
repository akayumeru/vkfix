import { PhotoSticker } from "./types";

export function getPhotoKey(ownerId: number, photoId: number): string {
  return `${ownerId}_${photoId}`;
}

/**
 * Имя файла из ссылки на картинку VK без расширения и параметров.
 * У всех размеров одной фотографии оно одинаковое, поэтому годится как её опознавательный знак
 * там, где VK не отдаёт ни owner_id, ни id - например в выборе фотографии для записи.
 */
export function getPhotoImageKey(url: string): string | undefined {
  return url.split("?")[0].split("/").at(-1)?.replace(/\.[a-z0-9]+$/i, "");
}

export function getPhotoStickerUrl(sticker: PhotoSticker): string {
  return (
    sticker.photo.sizes.find((s) => s.type === "x")?.url ??
    sticker.photo.sizes[0].url
  );
}

export function getPhotoStickerHref(sticker: PhotoSticker): string {
  const albumId = sticker.photo.album_id === -15
    ? "000"
    : sticker.photo.album_id.toString();
  const { owner_id: ownerId, id: photoId } = sticker.photo;

  return `https://${window.location.host}/album${ownerId}_${albumId}?z=photo${ownerId}_${photoId}`;
}
