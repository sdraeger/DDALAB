[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [components/ui](../README.md) / LoadingOverlay

# Function: LoadingOverlay()

> **LoadingOverlay**(`__namedParameters`): `Element` \| `null`

Defined in: [packages/ddalab-tauri/src/components/ui/loading-overlay.tsx:51](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/loading-overlay.tsx#L51)

Standardized loading overlay component.
Use this consistently across the app for async operations.

## Parameters

### \_\_namedParameters

`LoadingOverlayProps`

## Returns

`Element` \| `null`

## Example

```tsx
// Simple loading
<LoadingOverlay isLoading={isLoading} message="Loading files..." />

// With progress
<LoadingOverlay
  isLoading={isLoading}
  message="Analyzing data..."
  progress={75}
/>

// Wrapping content
<LoadingOverlay isLoading={isLoading} message="Saving...">
  <YourContent />
</LoadingOverlay>
```
