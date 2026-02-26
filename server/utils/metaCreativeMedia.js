export function extractMetaCreativeThumbnailUrl(creative) {
  if (!creative) return null;

  // Prefer full creative image sources before thumbnail_url because
  // thumbnail_url from Graph can be very small and blurry.
  if (creative.image_url) return creative.image_url;

  const videoImage = creative?.object_story_spec?.video_data?.image_url;
  if (videoImage) return videoImage;

  const linkImage =
    creative?.object_story_spec?.link_data?.image_url ||
    creative?.object_story_spec?.link_data?.picture;
  if (linkImage) return linkImage;

  const photoUrl =
    creative?.object_story_spec?.photo_data?.url ||
    creative?.object_story_spec?.photo_data?.image_url;
  if (photoUrl) return photoUrl;

  const assetImages = creative?.asset_feed_spec?.images;
  if (Array.isArray(assetImages) && assetImages.length > 0) {
    const image = assetImages[0];
    if (image?.url) return image.url;
    if (image?.image_url) return image.image_url;
  }

  const assetVideos = creative?.asset_feed_spec?.videos;
  if (Array.isArray(assetVideos) && assetVideos.length > 0) {
    const video = assetVideos[0];
    if (video?.thumbnail_url) return video.thumbnail_url;
    if (video?.picture) return video.picture;
  }

  const carouselElements = creative?.object_story_spec?.link_data?.child_attachments;
  if (Array.isArray(carouselElements) && carouselElements.length > 0) {
    const first = carouselElements[0];
    if (first?.picture) return first.picture;
    if (first?.image_url) return first.image_url;
  }

  if (creative.thumbnail_url) return creative.thumbnail_url;
  return null;
}

export function extractMetaCreativeVideoId(creative) {
  if (!creative) return null;

  const directVideoId = creative?.object_story_spec?.video_data?.video_id;
  if (directVideoId) return String(directVideoId);

  const linkVideoId = creative?.object_story_spec?.link_data?.video_id;
  if (linkVideoId) return String(linkVideoId);

  const assetVideos = creative?.asset_feed_spec?.videos;
  if (Array.isArray(assetVideos) && assetVideos.length > 0) {
    const videoEntry = assetVideos.find((video) => video?.video_id) || assetVideos[0];
    if (videoEntry?.video_id) return String(videoEntry.video_id);
  }

  const carouselElements = creative?.object_story_spec?.link_data?.child_attachments;
  if (Array.isArray(carouselElements)) {
    const videoElement = carouselElements.find((element) => element?.video_id);
    if (videoElement?.video_id) return String(videoElement.video_id);
  }

  return null;
}

export function extractBestMetaVideoThumbnailUrl(videoData) {
  const thumbnails = Array.isArray(videoData?.thumbnails?.data) ? videoData.thumbnails.data : [];
  const bestThumbnail = thumbnails.reduce((best, item) => {
    if (!item?.uri) return best;
    if (!best) return item;
    const bestArea = (Number(best.width) || 0) * (Number(best.height) || 0);
    const itemArea = (Number(item.width) || 0) * (Number(item.height) || 0);
    if (itemArea > bestArea) return item;
    return best;
  }, null);

  return bestThumbnail?.uri || videoData?.picture || thumbnails[0]?.uri || null;
}
