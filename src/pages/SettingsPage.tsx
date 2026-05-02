import { SyncCodeCard } from '@/components/settings/SyncCodeCard';
import { SyncFromOtherDevice } from '@/components/settings/SyncFromOtherDevice';
import { DisplaySettings } from '@/components/settings/DisplaySettings';
import { NotificationStatus } from '@/components/settings/NotificationStatus';
import { DataManagement } from '@/components/settings/DataManagement';

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">設定</h1>
      <SyncCodeCard />
      <SyncFromOtherDevice />
      <DisplaySettings />
      <NotificationStatus />
      <DataManagement />
    </div>
  );
}
