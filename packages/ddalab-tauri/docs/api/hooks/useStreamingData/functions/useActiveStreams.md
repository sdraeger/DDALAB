[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [hooks/useStreamingData](../README.md) / useActiveStreams

# Function: useActiveStreams()

> **useActiveStreams**(): `object`

Defined in: [packages/ddalab-tauri/src/hooks/useStreamingData.ts:93](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/hooks/useStreamingData.ts#L93)

Hook to get all active streaming sessions

## Returns

`object`

### allSessions

> **allSessions**: `StreamSession`[]

### activeSessions

> **activeSessions**: `StreamSession`[]

### runningSessions

> **runningSessions**: `StreamSession`[]

### sessionCount

> **sessionCount**: `number`

### activeCount

> **activeCount**: `number` = `activeSessions.length`

### runningCount

> **runningCount**: `number` = `runningSessions.length`
