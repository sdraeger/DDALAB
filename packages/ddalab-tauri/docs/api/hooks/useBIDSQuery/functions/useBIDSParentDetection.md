[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [hooks/useBIDSQuery](../README.md) / useBIDSParentDetection

# Function: useBIDSParentDetection()

> **useBIDSParentDetection**(`currentPath`, `dataDirectoryPath`): `object`

Defined in: [packages/ddalab-tauri/src/hooks/useBIDSQuery.ts:128](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/hooks/useBIDSQuery.ts#L128)

Hook to find BIDS root in parent directories.
Useful when navigating inside a BIDS dataset (e.g., after reveal).

## Parameters

### currentPath

`string`[]

### dataDirectoryPath

`string` | `null`

## Returns

`object`

### isLoading

> **isLoading**: `boolean`

### bidsRoot

> **bidsRoot**: `string` \| `null`

### bidsRootDepth

> **bidsRootDepth**: `number`

### currentDepthInBids

> **currentDepthInBids**: `number`
