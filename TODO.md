# DDALAB TODO

## Architecture Update (October 2025)

**New Backend Strategy:**

- ✅ Embedded Rust API is now the ONLY backend option
- ❌ Removed Docker/FastAPI external server selection
- 🔄 FastAPI will be phased out completely
- 🎯 Institutional broker replaces the need for shared servers (each DDALAB instance has its own API)
- 📱 Embedded API auto-starts when needed
- 🚨 Emergency start/stop controls available in Settings (rarely needed)

## Sync UI Integration Progress

###  Completed

1. **Backend Integration**

   -  Registered sync commands in `main.rs`
   -  Added `AppSyncState` to managed state
   -  Fixed `parking_lot::RwLock` � `tokio::sync::RwLock` for Send compatibility
   -  All 6 sync commands working: connect, disconnect, is_connected, share_result, access_share, revoke_share

2. **TypeScript Integration**

   -  Created `src/types/sync.ts` with AccessPolicy, ShareMetadata, SharedResultInfo interfaces
   -  Created `src/hooks/useSync.ts` hook with full React API
   -  Hook provides: isConnected, isLoading, error, connect, disconnect, shareResult, accessShare, revokeShare

3. **Settings UI**

   -  Added "Institutional Sync" card to SettingsPanel.tsx
   -  Connection status indicator (green dot when connected)
   -  Configuration form with broker URL, user ID, local endpoint inputs
   -  Connect/disconnect functionality with error handling
   -  Connected state showing user ID confirmation

4. **Broker Discovery (mDNS)**
   - Created broker-side discovery announcement system
   - Created client-side discovery scanning
   - SHA256 pre-shared key authentication (password never transmitted)
   - TLS/WSS support flags
   - Discovery UI in SettingsPanel with broker list display
   - Password input for authenticated brokers
   - Security indicators (Lock/Shield icons)
   - Integrated into broker startup
   - Environment config: INSTITUTION_NAME, BROKER_PASSWORD, USE_TLS
   - Added sync commands: sync_discover_brokers, sync_verify_password
   - Updated useSync hook with discoverBrokers and verifyPassword methods

### In Progress / TODO

5. **Peer Download Endpoint** (NOT STARTED)

   - [ ] Add HTTP endpoint in `embedded_api.rs` to serve shared results
   - [ ] Validate share tokens before allowing downloads
   - [ ] Serve result files securely via `/api/share/{token}/download`
   - [ ] Handle CORS for cross-origin requests

6. **Share/Access UI Components** (NOT STARTED)

   - [ ] Create `ShareResultDialog.tsx` component
     - [ ] Share button on analysis results
     - [ ] Access policy selector (public/team/specific users)
     - [ ] Share link display with copy button
     - [ ] Active shares list with revoke option
   - [ ] Create `AccessShareDialog.tsx` component
     - [ ] Paste share link input
     - [ ] Preview shared result metadata
     - [ ] Download button
   - [ ] Integrate dialogs into DDAResults.tsx or main UI

7. **Run DDA on .csv/.ascii files**

   - [ ] Find out what cli arguments to pass to binary to run on .csv/.ascii files

8. **BIDS + OpenNeuro + NEMAR Support **

### <� Mobile Compatibility Considerations

**Current Architecture:** P2P direct downloads between peers

-  Works on Desktop (macOS/Windows/Linux)
- L Won't work on iOS/Android (devices behind NAT, cannot accept incoming HTTP)

**Mobile Solutions:**

1. **Broker-Proxied Mode** (Recommended)

   - Broker temporarily stores small result files
   - Mobile devices download from broker instead of peer
   - Add platform detection: `cfg!(target_os = "ios") || cfg!(target_os = "android")`

2. **WebRTC Data Channels**

   - NAT traversal works on mobile
   - More complex implementation

3. **Hybrid Approach**
   - Desktop: Direct P2P (current design)
   - Mobile: Broker-proxied downloads

### =� Key Files Modified

- `src-tauri/src/main.rs` - Registered sync commands
- `src-tauri/src/sync/commands.rs` - Fixed tokio::RwLock compatibility
- `src/types/sync.ts` - Type definitions
- `src/hooks/useSync.ts` - React hook
- `src/components/SettingsPanel.tsx` - Sync configuration UI

### = Related Packages

- `packages/ddalab-broker/` - Institutional sync broker (Rust WebSocket server)
- `packages/ddalab-tauri/src-tauri/src/sync/` - SyncClient implementation

### =� Notes

- Sync is completely optional - app fully functional offline
- Local-first architecture - all data stays on device unless explicitly shared
- Broker only coordinates - actual data transfers are peer-to-peer (on desktop)
- No authentication on broker yet - user ID is self-declared
