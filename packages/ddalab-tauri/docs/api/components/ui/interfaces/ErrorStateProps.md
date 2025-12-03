[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [components/ui](../README.md) / ErrorStateProps

# Interface: ErrorStateProps

Defined in: [packages/ddalab-tauri/src/components/ui/error-state.tsx:11](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/error-state.tsx#L11)

## Properties

### message

> **message**: `string`

Defined in: [packages/ddalab-tauri/src/components/ui/error-state.tsx:13](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/error-state.tsx#L13)

Error message to display

---

### title?

> `optional` **title**: `string`

Defined in: [packages/ddalab-tauri/src/components/ui/error-state.tsx:15](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/error-state.tsx#L15)

Optional title for the error

---

### severity?

> `optional` **severity**: [`ErrorSeverity`](../type-aliases/ErrorSeverity.md)

Defined in: [packages/ddalab-tauri/src/components/ui/error-state.tsx:17](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/error-state.tsx#L17)

Severity level affects styling

---

### onRetry()?

> `optional` **onRetry**: () => `void`

Defined in: [packages/ddalab-tauri/src/components/ui/error-state.tsx:19](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/error-state.tsx#L19)

Called when retry button is clicked

#### Returns

`void`

---

### onDismiss()?

> `optional` **onDismiss**: () => `void`

Defined in: [packages/ddalab-tauri/src/components/ui/error-state.tsx:21](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/error-state.tsx#L21)

Called when dismiss button is clicked

#### Returns

`void`

---

### isRetrying?

> `optional` **isRetrying**: `boolean`

Defined in: [packages/ddalab-tauri/src/components/ui/error-state.tsx:23](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/error-state.tsx#L23)

Whether retry is in progress

---

### className?

> `optional` **className**: `string`

Defined in: [packages/ddalab-tauri/src/components/ui/error-state.tsx:25](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/error-state.tsx#L25)

Additional CSS classes

---

### variant?

> `optional` **variant**: `"inline"` \| `"block"` \| `"toast"`

Defined in: [packages/ddalab-tauri/src/components/ui/error-state.tsx:27](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/error-state.tsx#L27)

Render as compact inline or full block
