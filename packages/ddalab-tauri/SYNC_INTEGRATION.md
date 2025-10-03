# Sync Integration Guide

## Registering Tauri Commands

Add sync commands to your `main.rs`:

```rust
use ddalab_tauri::sync::AppSyncState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // ... other plugins ...
        .manage(AppSyncState::new())  // Add sync state
        .invoke_handler(tauri::generate_handler![
            // ... existing commands ...

            // Sync commands
            ddalab_tauri::sync::commands::sync_connect,
            ddalab_tauri::sync::commands::sync_disconnect,
            ddalab_tauri::sync::commands::sync_is_connected,
            ddalab_tauri::sync::commands::sync_share_result,
            ddalab_tauri::sync::commands::sync_access_share,
            ddalab_tauri::sync::commands::sync_revoke_share,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## TypeScript Types

Create `src/types/sync.ts`:

```typescript
export interface AccessPolicy {
  type: 'public' | 'team' | 'users';
  team_id?: string;
  user_ids?: string[];
}

export interface ShareMetadata {
  owner_user_id: string;
  result_id: string;
  title: string;
  description?: string;
  created_at: string;
  access_policy: AccessPolicy;
}

export interface SharedResultInfo {
  metadata: ShareMetadata;
  download_url: string;
  owner_online: boolean;
}
```

## React Hook Example

Create `src/hooks/useSync.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect } from 'react';
import type { AccessPolicy, SharedResultInfo } from '@/types/sync';

export function useSync() {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const connected = await invoke<boolean>('sync_is_connected');
      setIsConnected(connected);
    } catch (err) {
      setIsConnected(false);
    }
  };

  const connect = async (
    brokerUrl: string,
    userId: string,
    localEndpoint: string
  ) => {
    await invoke('sync_connect', { brokerUrl, userId, localEndpoint });
    setIsConnected(true);
  };

  const disconnect = async () => {
    await invoke('sync_disconnect');
    setIsConnected(false);
  };

  const shareResult = async (
    resultId: string,
    title: string,
    description: string | null,
    accessPolicy: AccessPolicy
  ): Promise<string> => {
    return await invoke('sync_share_result', {
      resultId,
      title,
      description,
      accessPolicy,
    });
  };

  const accessShare = async (token: string): Promise<SharedResultInfo> => {
    return await invoke('sync_access_share', { token });
  };

  const revokeShare = async (token: string): Promise<void> => {
    await invoke('sync_revoke_share', { token });
  };

  return {
    isConnected,
    connect,
    disconnect,
    shareResult,
    accessShare,
    revokeShare,
  };
}
```

## UI Components

### Share Button Component

```typescript
import { useState } from 'react';
import { useSync } from '@/hooks/useSync';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function ShareButton({ resultId, title }: { resultId: string; title: string }) {
  const { isConnected, shareResult } = useSync();
  const [isSharing, setIsSharing] = useState(false);

  const handleShare = async () => {
    if (!isConnected) {
      toast.error('Sync is not enabled. Enable in Settings.');
      return;
    }

    setIsSharing(true);
    try {
      const shareLink = await shareResult(resultId, title, null, {
        type: 'public',
      });

      await navigator.clipboard.writeText(shareLink);
      toast.success('Share link copied to clipboard!');
    } catch (err) {
      toast.error('Failed to share: ' + err);
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <Button onClick={handleShare} disabled={!isConnected || isSharing}>
      {isSharing ? 'Sharing...' : 'Share'}
    </Button>
  );
}
```

### Import Share Component

```typescript
import { useState } from 'react';
import { useSync } from '@/hooks/useSync';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export function ImportShare() {
  const { isConnected, accessShare } = useSync();
  const [shareLink, setShareLink] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  const handleImport = async () => {
    const token = shareLink.replace('ddalab://share/', '');

    setIsImporting(true);
    try {
      const shareInfo = await accessShare(token);

      if (!shareInfo.owner_online) {
        toast.error('Owner is offline. Try again later.');
        return;
      }

      // Download the result
      const response = await fetch(shareInfo.download_url);
      if (!response.ok) throw new Error('Failed to download');

      const result = await response.json();

      // Save locally (implement this)
      // await saveResult(result);

      toast.success('Result imported successfully!');
      setShareLink('');
    } catch (err) {
      toast.error('Failed to import: ' + err);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Input
        placeholder="ddalab://share/..."
        value={shareLink}
        onChange={(e) => setShareLink(e.target.value)}
        disabled={!isConnected}
      />
      <Button onClick={handleImport} disabled={!isConnected || isImporting}>
        {isImporting ? 'Importing...' : 'Import'}
      </Button>
    </div>
  );
}
```

## Settings Integration

```typescript
import { useSync } from '@/hooks/useSync';
import { useState } from 'react';

export function SyncSettings() {
  const { isConnected, connect, disconnect } = useSync();
  const [brokerUrl, setBrokerUrl] = useState('wss://ddalab-sync.university.edu/ws');
  const [userId, setUserId] = useState('');
  const [localEndpoint, setLocalEndpoint] = useState('http://localhost:3001');

  const handleConnect = async () => {
    try {
      await connect(brokerUrl, userId, localEndpoint);
      toast.success('Connected to sync broker');
    } catch (err) {
      toast.error('Failed to connect: ' + err);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      toast.success('Disconnected from sync broker');
    } catch (err) {
      toast.error('Failed to disconnect: ' + err);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label>Broker URL</label>
        <Input
          value={brokerUrl}
          onChange={(e) => setBrokerUrl(e.target.value)}
          disabled={isConnected}
        />
      </div>

      <div>
        <label>User ID (email)</label>
        <Input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          disabled={isConnected}
        />
      </div>

      <div>
        <label>Local Endpoint</label>
        <Input
          value={localEndpoint}
          onChange={(e) => setLocalEndpoint(e.target.value)}
          disabled={isConnected}
        />
      </div>

      {isConnected ? (
        <Button onClick={handleDisconnect} variant="destructive">
          Disconnect
        </Button>
      ) : (
        <Button onClick={handleConnect}>
          Connect
        </Button>
      )}
    </div>
  );
}
```

## Testing

Test with two Tauri instances:

```bash
# Terminal 1: Broker
cd packages/ddalab-broker
./dev.sh dev

# Terminal 2: Alice's instance
cd packages/ddalab-tauri
PORT=3001 npm run tauri:dev

# Terminal 3: Bob's instance
cd packages/ddalab-tauri
PORT=3002 npm run tauri:dev
```

Configure each instance:
- Alice: `alice@test.edu`, endpoint `http://localhost:3001`
- Bob: `bob@test.edu`, endpoint `http://localhost:3002`

Then test sharing between them!
