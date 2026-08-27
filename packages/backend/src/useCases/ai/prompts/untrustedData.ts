/** Serialize story/imported content so it cannot close or forge prompt delimiters. */
export function serializeUntrustedData(label: string, value: unknown): string {
  const safeLabel = label.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const json = JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/Layer (?=[A-F]\b)/g, 'Layer\\u0020');
  return `<untrusted_data label="${safeLabel}" encoding="json-unicode-escaped">\n${json}\n</untrusted_data>`;
}

/** Serialize explicit owner instructions without allowing prompt-structure breakout. */
export function serializeAuthorityData(value: unknown): string {
  const json = JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/Layer (?=[A-F]\b)/g, 'Layer\\u0020');
  return `<owner_authority encoding="json-unicode-escaped">\n${json}\n</owner_authority>`;
}
