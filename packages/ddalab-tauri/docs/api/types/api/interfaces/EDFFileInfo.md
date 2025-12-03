[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [types/api](../README.md) / EDFFileInfo

# Interface: EDFFileInfo

Defined in: [packages/ddalab-tauri/src/types/api.ts:12](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L12)

## Properties

### file_path

> **file_path**: `string`

Defined in: [packages/ddalab-tauri/src/types/api.ts:13](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L13)

---

### file_name

> **file_name**: `string`

Defined in: [packages/ddalab-tauri/src/types/api.ts:14](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L14)

---

### file_size

> **file_size**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:15](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L15)

---

### duration

> **duration**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:16](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L16)

---

### sample_rate

> **sample_rate**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:17](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L17)

---

### channels

> **channels**: `string`[]

Defined in: [packages/ddalab-tauri/src/types/api.ts:18](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L18)

---

### total_samples

> **total_samples**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:19](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L19)

---

### start_time

> **start_time**: `string`

Defined in: [packages/ddalab-tauri/src/types/api.ts:20](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L20)

---

### end_time

> **end_time**: `string`

Defined in: [packages/ddalab-tauri/src/types/api.ts:21](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L21)

---

### annotations_count?

> `optional` **annotations_count**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:22](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L22)

---

### is_annex_placeholder?

> `optional` **is_annex_placeholder**: `boolean`

Defined in: [packages/ddalab-tauri/src/types/api.ts:24](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L24)

True if file is a git-annex placeholder that hasn't been downloaded

---

### bidsMetadata?

> `optional` **bidsMetadata**: [`BIDSMetadata`](BIDSMetadata.md)

Defined in: [packages/ddalab-tauri/src/types/api.ts:26](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L26)

BIDS metadata if file is in BIDS format
