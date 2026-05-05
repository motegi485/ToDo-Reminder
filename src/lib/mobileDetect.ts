export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS 13+ は UA が "Macintosh" になるが、maxTouchPoints で判別できる
  const isIPadOS = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || isIPadOS;
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}
