[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [types/api](../README.md) / DDAAnalysisRequest

# Interface: DDAAnalysisRequest

Defined in: [packages/ddalab-tauri/src/types/api.ts:62](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L62)

## Properties

### file_path

> **file_path**: `string`

Defined in: [packages/ddalab-tauri/src/types/api.ts:63](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L63)

---

### channels

> **channels**: `string`[]

Defined in: [packages/ddalab-tauri/src/types/api.ts:64](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L64)

---

### start_time

> **start_time**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:65](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L65)

---

### end_time

> **end_time**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:66](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L66)

---

### variants

> **variants**: `string`[]

Defined in: [packages/ddalab-tauri/src/types/api.ts:67](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L67)

---

### window_length?

> `optional` **window_length**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:68](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L68)

---

### window_step?

> `optional` **window_step**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:69](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L69)

---

### scale_min?

> `optional` **scale_min**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:70](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L70)

---

### scale_max?

> `optional` **scale_max**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:71](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L71)

---

### scale_num?

> `optional` **scale_num**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:72](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L72)

---

### delay_list?

> `optional` **delay_list**: `number`[]

Defined in: [packages/ddalab-tauri/src/types/api.ts:73](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L73)

---

### ct_window_length?

> `optional` **ct_window_length**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:75](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L75)

---

### ct_window_step?

> `optional` **ct_window_step**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:76](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L76)

---

### ct_channel_pairs?

> `optional` **ct_channel_pairs**: \[`number`, `number`\][]

Defined in: [packages/ddalab-tauri/src/types/api.ts:77](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L77)

---

### cd_channel_pairs?

> `optional` **cd_channel_pairs**: \[`number`, `number`\][]

Defined in: [packages/ddalab-tauri/src/types/api.ts:79](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L79)

---

### model_dimension?

> `optional` **model_dimension**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:81](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L81)

---

### polynomial_order?

> `optional` **polynomial_order**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:82](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L82)

---

### nr_tau?

> `optional` **nr_tau**: `number`

Defined in: [packages/ddalab-tauri/src/types/api.ts:83](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L83)

---

### model_params?

> `optional` **model_params**: `number`[]

Defined in: [packages/ddalab-tauri/src/types/api.ts:84](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L84)

---

### variant_configs?

> `optional` **variant_configs**: `object`

Defined in: [packages/ddalab-tauri/src/types/api.ts:86](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/types/api.ts#L86)

#### Index Signature

\[`variantId`: `string`\]: [`DDAVariantConfig`](DDAVariantConfig.md)
