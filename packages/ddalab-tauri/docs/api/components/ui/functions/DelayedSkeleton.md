[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [components/ui](../README.md) / DelayedSkeleton

# Function: DelayedSkeleton()

> **DelayedSkeleton**(`__namedParameters`): `Element` \| `null`

Defined in: [packages/ddalab-tauri/src/components/ui/skeleton-variants.tsx:36](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/skeleton-variants.tsx#L36)

Wrapper component that delays showing skeleton content to prevent flash.
Only renders skeleton if loading takes longer than the delay.

## Parameters

### \_\_namedParameters

#### isLoading

`boolean`

#### delay?

`number` = `200`

#### children

`ReactNode`

#### skeleton

`ReactNode`

## Returns

`Element` \| `null`
