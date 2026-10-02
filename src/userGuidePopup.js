const POPUP_MAX_WIDTH = 1180;
const POPUP_MAX_HEIGHT = 820;
const POPUP_MIN_WIDTH = 720;
const POPUP_MIN_HEIGHT = 560;

/** Size the guide below the available screen while keeping it useful on laptops. */
export function userGuidePopupBounds(screenRef = globalThis.screen) {
  const availableWidth = Math.max(1, Number(screenRef?.availWidth) || 1280);
  const availableHeight = Math.max(1, Number(screenRef?.availHeight) || 800);
  const availableLeft = Number(screenRef?.availLeft) || 0;
  const availableTop = Number(screenRef?.availTop) || 0;
  const width = Math.min(
    Math.max(320, availableWidth - 40),
    Math.max(POPUP_MIN_WIDTH, Math.floor(availableWidth * 0.86)),
    POPUP_MAX_WIDTH,
  );
  const height = Math.min(
    Math.max(360, availableHeight - 40),
    Math.max(POPUP_MIN_HEIGHT, Math.floor(availableHeight * 0.86)),
    POPUP_MAX_HEIGHT,
  );
  return {
    width,
    height,
    left: availableLeft + Math.max(0, Math.floor((availableWidth - width) / 2)),
    top: availableTop + Math.max(0, Math.floor((availableHeight - height) / 2)),
  };
}

export function userGuidePopupFeatures(screenRef = globalThis.screen) {
  const { width, height, left, top } = userGuidePopupBounds(screenRef);
  return [
    'popup=yes',
    'resizable=yes',
    'scrollbars=yes',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
  ].join(',');
}

/** Open one reusable guide popup while retaining the link's new-tab fallback. */
export function bindUserGuidePopup({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) {
  const link = documentRef?.getElementById?.('user-guide-link');
  if (!link || !windowRef?.open) return () => {};
  const handleClick = (event) => {
    const popup = windowRef.open(
      link.href,
      'norsaga-user-guide',
      userGuidePopupFeatures(windowRef.screen),
    );
    if (!popup) return;
    event.preventDefault();
    popup.focus?.();
  };
  link.addEventListener('click', handleClick);
  return () => link.removeEventListener('click', handleClick);
}
