/** The team's avatar cards (public/cards/<key>.png, e.g. dev-1.png). Missing art just hides the image. */
export function cardImg(key: string, alt: string, cls = "avatar-card"): HTMLImageElement {
  const img = document.createElement("img");
  img.className = cls;
  img.alt = alt;
  img.title = alt;
  img.src = `cards/${key.replace(":", "-")}.png`;
  img.onerror = () => img.remove();
  return img;
}
