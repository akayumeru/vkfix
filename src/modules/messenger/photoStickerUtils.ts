import { PhotoSticker } from "./types";

export function getPhotoKey(ownerId: number, photoId: number): string {
  return `${ownerId}_${photoId}`;
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
