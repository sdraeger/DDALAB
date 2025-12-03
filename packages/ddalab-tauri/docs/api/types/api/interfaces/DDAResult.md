[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [types/api](../README.md) / DDAResult

# Interface: DDAResult

Defined in: [packages/ddalab-tauri/src/types/api.ts:121](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L121)

## Properties

### id

> **id**: `string`

Defined in: [packages/ddalab-tauri/src/types/api.ts:122](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L122)

---

### name?

> `optional` **name**: `string`

Defined in: [packages/ddalab-tauri/src/types/api.ts:123](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L123)

---

### file_path

> **file_path**: `string`

Defined in: [packages/ddalab-tauri/src/types/api.ts:124](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L124)

---

### channels

> **channels**: `string`[]

Defined in: [packages/ddalab-tauri/src/types/api.ts:125](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L125)

---

### parameters

> **parameters**: [`DDAAnalysisRequest`](DDAAnalysisRequest.md)

Defined in: [packages/ddalab-tauri/src/types/api.ts:126](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L126)

---

### results

> **results**: `object`

Defined in: [packages/ddalab-tauri/src/types/api.ts:127](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L127)

#### scales

> **scales**: `number`[]

#### variants

> **variants**: [`DDAVariantResult`](DDAVariantResult.md)[]

#### dda_matrix?

> `optional` **dda_matrix**: `Record`\<`string`, `number`[]\>

#### exponents?

> `optional` **exponents**: `Record`\<`string`, `number`\>

#### quality_metrics?

> `optional` **quality_metrics**: `Record`\<`string`, `number`\>

---

### status

> **status**: `"pending"` \| `"running"` \| `"completed"` \| `"failed"`

Defined in: [packages/ddalab-tauri/src/types/api.ts:135](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L135)

---

### created_at

> **created_at**: `string`

Defined in: [packages/ddalab-tauri/src/types/api.ts:136](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L136)

---

### completed_at?

> `optional` **completed_at**: `string`

Defined in: [packages/ddalab-tauri/src/types/api.ts:137](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L137)

---

### error_message?

> `optional` **error_message**: `string`

Defined in: [packages/ddalab-tauri/src/types/api.ts:138](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L138)

---

### source?

> `optional` **source**: `"local"` \| `"nsg"`

Defined in: [packages/ddalab-tauri/src/types/api.ts:139](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L139)
