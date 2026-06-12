/**
 * Shared Turkish folding logic.
 * Ensures case-insensitive and diacritics-insensitive searching for Turkish locales.
 */
export function foldTurkish(str: string): string {
  if (!str) return '';
  
  // Convert standard Turkish case folding
  let folded = str.toLocaleLowerCase('tr-TR');
  
  // Strip combining dot above
  folded = folded.replace(/\u0307/g, '');
  
  // Map specific Turkish characters to basic Latin equivalents
  const mapping: { [key: string]: string } = {
    'ı': 'i',
    'ş': 's',
    'ç': 'c',
    'ğ': 'g',
    'ü': 'u',
    'ö': 'o'
  };
  
  let result = '';
  for (let i = 0; i < folded.length; i++) {
    const char = folded[i];
    result += mapping[char] !== undefined ? mapping[char] : char;
  }
  
  return result;
}
