[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [components/ui](../README.md) / useLoadingAnnouncement

# Function: useLoadingAnnouncement()

> **useLoadingAnnouncement**(`isLoading`, `loadingMessage`, `completeMessage`): `void`

Defined in: [packages/ddalab-tauri/src/components/ui/status-announcer.tsx:147](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/status-announcer.tsx#L147)

Hook for announcing loading state changes.

## Parameters

### isLoading

`boolean`

### loadingMessage

`string` = `"Loading..."`

### completeMessage

`string` = `"Complete"`

## Returns

`void`

## Example

```tsx
useLoadingAnnouncement(isLoading, "Analyzing data...", "Analysis complete");
```
