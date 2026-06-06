let iosSwitch: HTMLLabelElement | null = null;

function getIosSwitch(): HTMLLabelElement {
  if (iosSwitch) return iosSwitch;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText =
    'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', ''); // iOS 18+ の非標準 switch 属性
  label.appendChild(input);
  document.body.appendChild(label);
  return (iosSwitch = label);
}

export type HapticKind = 'select' | 'success' | 'warning';

const patterns: Record<HapticKind, number[]> = {
  select: [10],
  success: [12, 30, 18],
  warning: [30, 40, 30],
};

/**
 * 触覚フィードバック。Android/Chromium は Vibration API、
 * iOS 18+ Safari は非標準の switch チェックボックスを click して native の触覚を出す。
 * 非対応端末は無音。
 */
export function haptic(kind: HapticKind = 'select'): void {
  if ('vibrate' in navigator) {
    navigator.vibrate(patterns[kind]); // Android / Chromium
    return;
  }
  try {
    getIosSwitch().click(); // iOS 18+
  } catch {
    /* 非対応端末は無音 */
  }
}
