export function vibrate(ms: number = 50): void {
  if ('vibrate' in navigator) {
    navigator.vibrate(ms);
  }
}
