/**
 * high-performance, completely dependency-free advanced mathematics library
 * built in pure TypeScript.
 */
export class QuantumEngine {
  /**
   * Calculates the Dot Product of two vectors.
   * Complexity: O(n)
   */
  static vectorDot(v1: number[], v2: number[]): number {
    if (v1.length !== v2.length) {
      throw new Error("Vector dimensions must match for dot product.");
    }
    if (v1.length === 0) {
      throw new Error("Vectors cannot be empty.");
    }
    return v1.reduce((sum, val, idx) => sum + val * v2[idx], 0);
  }

  /**
   * Performs matrix multiplication.
   * Optimizes cache locality by transposing Matrix B prior to index aggregation.
   * Complexity: O(n * m * p)
   */
  static matrixMultiply(A: number[][], B: number[][]): number[][] {
    if (A.length === 0 || B.length === 0 || A[0].length === 0 || B[0].length === 0) {
      throw new Error("Matrices cannot be empty.");
    }

    const rowsA = A.length;
    const colsA = A[0].length;
    const rowsB = B.length;
    const colsB = B[0].length;

    if (colsA !== rowsB) {
      throw new Error(`Incompatible dimensions for multiplication: ${colsA} vs ${rowsB}`);
    }

    // Transpose B for row-oriented contiguous sequential access
    const BT: number[][] = Array.from({ length: colsB }, () => new Array(rowsB));
    for (let i = 0; i < rowsB; i++) {
      for (let j = 0; j < colsB; j++) {
        BT[j][i] = B[i][j];
      }
    }

    const result: number[][] = Array.from({ length: rowsA }, () => new Array(colsB));
    for (let r = 0; r < rowsA; r++) {
      const rowA = A[r];
      for (let c = 0; c < colsB; c++) {
        const colB = BT[c];
        let sum = 0;
        for (let i = 0; i < colsA; i++) {
          sum += rowA[i] * colB[i];
        }
        result[r][c] = sum;
      }
    }

    return result;
  }

  /**
   * Computes Sigmoid activation function. Prevents overflow.
   * Complexity: O(1)
   */
  static sigmoid(x: number): number {
    if (x < -709) return 0;
    if (x > 709) return 1;
    return 1 / (1 + Math.exp(-x));
  }

  /**
   * Calculates Shannon Entropy (Information Theory metric of uncertainty).
   * Complexity: O(n)
   */
  static calculateEntropy(probabilities: number[]): number {
    if (probabilities.length === 0) {
      throw new Error("Probability vector cannot be empty.");
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

  /**
   * Calculates sample variance.
   * Complexity: O(n)
   */
  static variance(data: number[]): number {
    const n = data.length;
    if (n < 2) return 0;
    const mean = data.reduce((s, x) => s + x, 0) / n;
    const sumSqDiff = data.reduce((s, x) => s + Math.pow(x - mean, 2), 0);
    return sumSqDiff / (n - 1);
  }

  /**
   * Calculates standard deviation.
   * Complexity: O(n)
   */
  static stdDev(data: number[]): number {
    return Math.sqrt(QuantumEngine.variance(data));
  }

  /**
   * Calculates Cosine Similarity between two vectors.
   * Complexity: O(n)
   */
  static cosineSimilarity(v1: number[], v2: number[]): number {
    if (v1.length !== v2.length) {
      throw new Error("Dimensions must match for cosine similarity.");
    }

    const dot = QuantumEngine.vectorDot(v1, v2);
    const normA = Math.sqrt(v1.reduce((s, x) => s + x * x, 0));
    const normB = Math.sqrt(v2.reduce((s, x) => s + x * x, 0));

    if (normA === 0 || normB === 0) return 0;
    return dot / (normA * normB);
  }
}
