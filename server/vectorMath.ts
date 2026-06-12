/**
 * Dependency-free vector/statistics helpers used by the local semantic ranking.
 */
export class VectorMath {
  /** Dot product of two equal-length vectors. O(n) */
  static vectorDot(v1: number[], v2: number[]): number {
    if (v1.length !== v2.length) {
      throw new Error('Vector dimensions must match for dot product.');
    }
    if (v1.length === 0) {
      throw new Error('Vectors cannot be empty.');
    }
    return v1.reduce((sum, val, idx) => sum + val * v2[idx], 0);
  }

  /** Shannon entropy of a probability vector (normalizes if needed). O(n) */
  static calculateEntropy(probabilities: number[]): number {
    if (probabilities.length === 0) {
      throw new Error('Probability vector cannot be empty.');
    }
    const sumP = probabilities.reduce((s, p) => s + p, 0);
    let normalized = probabilities;
    if (Math.abs(sumP - 1.0) > 1e-5) {
      normalized = probabilities.map(p => p / (sumP || 1));
    }
    let entropy = 0;
    for (const p of normalized) {
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }
    return entropy;
  }

  /** Sample variance. O(n) */
  static variance(data: number[]): number {
    const n = data.length;
    if (n < 2) return 0;
    const mean = data.reduce((s, x) => s + x, 0) / n;
    const sumSqDiff = data.reduce((s, x) => s + Math.pow(x - mean, 2), 0);
    return sumSqDiff / (n - 1);
  }

  /** Sample standard deviation. O(n) */
  static stdDev(data: number[]): number {
    return Math.sqrt(VectorMath.variance(data));
  }

  /** Cosine similarity between two equal-length vectors. O(n) */
  static cosineSimilarity(v1: number[], v2: number[]): number {
    if (v1.length !== v2.length) {
      throw new Error('Dimensions must match for cosine similarity.');
    }
    const dot = VectorMath.vectorDot(v1, v2);
    const normA = Math.sqrt(v1.reduce((s, x) => s + x * x, 0));
    const normB = Math.sqrt(v2.reduce((s, x) => s + x * x, 0));
    if (normA === 0 || normB === 0) return 0;
    return dot / (normA * normB);
  }
}
