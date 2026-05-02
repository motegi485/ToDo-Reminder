import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (online) return null;
  return (
    <div className="w-full bg-amber-500/90 text-white text-xs text-center py-1">
      オフラインです
    </div>
  );
}
