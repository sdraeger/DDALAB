[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [components/ui](../README.md) / VirtualizedListProps

# Interface: VirtualizedListProps\<T\>

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:11](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L11)

## Type Parameters

### T

`T`

## Properties

### items

> **items**: `T`[]

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:13](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L13)

The items to render

---

### itemHeight

> **itemHeight**: `number`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:15](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L15)

Height of each item in pixels (for fixed size list)

---

### height

> **height**: `number`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:17](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L17)

Height of the list container

---

### width?

> `optional` **width**: `string` \| `number`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:19](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L19)

Width of the list container (default: 100%)

---

### renderItem()

> **renderItem**: (`item`, `index`, `style`) => `ReactNode`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:21](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L21)

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

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:27](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L27)

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

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:29](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L29)

Optional className for the list container

---

### overscanCount?

> `optional` **overscanCount**: `number`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:31](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L31)

Number of items to overscan (render outside visible area)

---

### emptyState?

> `optional` **emptyState**: `ReactNode`

Defined in: [packages/ddalab-tauri/src/components/ui/virtualized-list.tsx:33](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/virtualized-list.tsx#L33)

Optional empty state
