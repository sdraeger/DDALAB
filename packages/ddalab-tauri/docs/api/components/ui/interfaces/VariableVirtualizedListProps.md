[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [components/ui](../README.md) / VariableVirtualizedListProps

# Interface: VariableVirtualizedListProps\<T\>

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:86](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L86)

## Type Parameters

### T

`T`

## Properties

### items

> **items**: `T`[]

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:88](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L88)

The items to render

---

### getItemHeight()

> **getItemHeight**: (`index`) => `number`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:90](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L90)

Function to get height of each item

#### Parameters

##### index

`number`

#### Returns

`number`

---

### height

> **height**: `number`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:92](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L92)

Height of the list container

---

### width?

> `optional` **width**: `string` \| `number`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:94](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L94)

Width of the list container (default: 100%)

---

### renderItem()

> **renderItem**: (`item`, `index`, `style`) => `ReactNode`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:96](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L96)

Render function for each item

#### Parameters

##### item

`T`

##### index

`number`

##### style

`CSSProperties`

#### Returns

`ReactNode`

---

### getItemKey()?

> `optional` **getItemKey**: (`item`, `index`) => `string` \| `number`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:102](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L102)

Key extractor for each item

#### Parameters

##### item

`T`

##### index

`number`

#### Returns

`string` \| `number`

---

### className?

> `optional` **className**: `string`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:104](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L104)

Optional className for the list container

---

### overscanCount?

> `optional` **overscanCount**: `number`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:106](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L106)

Number of items to overscan (render outside visible area)

---

### emptyState?

> `optional` **emptyState**: `ReactNode`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:108](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L108)

Optional empty state
