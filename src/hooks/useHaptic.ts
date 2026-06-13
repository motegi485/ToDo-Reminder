let iosSwitch: HTMLLabelElement | null = null;

function getIosSwitch(): HTMLLabelElement {
  if (iosSwitch) return iosSwitch;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText =
    'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', ''); // Safari 17.4+（iOS 17.4+）の非標準 switch 属性
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
 * 触覚フィードバック（ベストエフォート）。
 *
 * - Android / Chromium: Vibration API（navigator.vibrate）で発火する。
 * - iOS 17.4〜26.4 Safari: Vibration API が無いため、非表示の
 *   `<input type="checkbox" switch>` を label 経由で click し、OS ネイティブの
 *   switch 触覚を借用する非公式ハックで発火する。
 * - iOS 26.5+ : Apple がこのハックを塞いだため、JS からは発火できない（無音）。
 *   ユーザーが実際のネイティブ switch UI を直接タップした時しか鳴らない仕様に
 *   変更された。iOS Safari には Vibration API も Web 版 Core Haptics も無く、
 *   独自デザインのボタンのタップから触覚を鳴らす公式手段は存在しない。
 *   将来 Web Haptics API が提供されたら対応する。
 *   参考: https://github.com/tijnjh/ios-haptics
 * - その他の非対応端末: 無音。
 */
export function haptic(kind: HapticKind = 'select'): void {
  if ('vibrate' in navigator) {
    navigator.vibrate(patterns[kind]); // Android / Chromium
    return;
  }
  try {
    // iOS 17.4〜26.4 のみ発火。iOS 26.5+ では no-op（Apple がハックを塞いだ）。
    getIosSwitch().click();
  } catch {
    /* 非対応端末は無音 */
  }
}
