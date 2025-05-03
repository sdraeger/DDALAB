export function snakeToCamel(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map((item) => snakeToCamel(item));
  }
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  const camelObj: Record<string, any> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) =>
        letter.toUpperCase()
      );
      camelObj[camelKey] = snakeToCamel(obj[key]);
    }
  }
  return camelObj;
}
