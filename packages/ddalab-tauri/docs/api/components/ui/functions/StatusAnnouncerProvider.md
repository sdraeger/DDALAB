[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [components/ui](../README.md) / StatusAnnouncerProvider

# Function: StatusAnnouncerProvider()

> **StatusAnnouncerProvider**(`__namedParameters`): `Element`

Defined in: [packages/ddalab-tauri/src/components/ui/status-announcer.tsx:54](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/status-announcer.tsx#L54)

Provider component that renders hidden aria-live regions.
Wrap your app with this to enable status announcements.

## Parameters

### \_\_namedParameters

`StatusAnnouncerProviderProps`

## Returns

`Element`

## Example

```tsx
// In your layout
<StatusAnnouncerProvider>
  <App />
</StatusAnnouncerProvider>;

// In any component
const { announce } = useStatusAnnouncer();
announce("File loaded successfully");
```
