/**
 * 图文与实况图解析器（架构预留占位，v1 仅检测数量与类型，暂不实现下载）
 */

export function inspectImageNote(note) {
  const list = Array.isArray(note?.imageList) ? note.imageList : [];
  const liveCount = list.filter((img) => Boolean(img?.livePhoto)).length;
  const imageCount = list.length;

  return {
    noteType: liveCount > 0 ? 'live_photo' : 'image',
    imageCount,
    liveCount
  };
}

export function parseImageNote(_note) {
  // v2 在此返回 MediaAsset[]（kind: 'image' | 'live_photo'）
  return [];
}
