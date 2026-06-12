/**
 * Masks secret patterns before they leave the server.
 */
export function maskSecrets(text: string): string {
  if (!text) return '';
  let masked = text;

  // Mask ghp_ and gho_ tokens
  masked = masked.replace(/ghp_[A-Za-z0-9]{36}/g, '•••MASKED•••');
  masked = masked.replace(/gho_[A-Za-z0-9]{36}/g, '•••MASKED•••');

  // Mask classic github_pat_
  masked = masked.replace(/github_pat_[A-Za-z0-9_]{20,}/g, '•••MASKED•••');

  // OpenAI sk- keys
  masked = masked.replace(/sk-[A-Za-z0-9_-]{20,}/g, '•••MASKED•••');

  // AWS access key
  masked = masked.replace(/AKIA[0-9A-Z]{16}/g, '•••MASKED•••');

  // Private key headers
  masked = masked.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, '•••MASKED•••');

  // Generic key/password/token parameter assigments with length >= 20
  // Supports formats like API_KEY = "something_long" or token:"somelongstring"
  masked = masked.replace(
    /((?:token|secret|password|api[_-]?key)\s*[:=]\s*['"]?)([A-Za-z0-9_\-\.\+\/\\=\@]{20,})(['"]?)/gi,
    (match, prefix, secretValue, suffix) => {
      return `${prefix}•••MASKED•••${suffix}`;
    }
  );

  return masked;
}
