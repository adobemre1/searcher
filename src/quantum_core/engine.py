import math
from typing import List, Union, Tuple

# Type Definitions for Clarity
Number = Union[int, float]
Vector = List[Number]
Matrix = List[Vector]

class QuantumEngine:
    """
    Genesis Quantum Engine.
    High-performance, dependency-free advanced mathematics library.
    All algorithms are optimized for list comprehensions and cash-locality.
    """

    @staticmethod
    def vector_dot(v1: Vector, v2: Vector) -> Number:
        """
        Calculates the Dot Product of two vectors.
        Complexity: O(n)
        """
        if len(v1) != len(v2):
            raise ValueError("Vector dimensions must match for dot product.")
        if len(v1) == 0:
            raise ValueError("Vectors cannot be empty.")
        return sum(x * y for x, y in zip(v1, v2))

    @staticmethod
    def matrix_multiply(A: Matrix, B: Matrix) -> Matrix:
        """
        Performs matrix multiplication in pure Python.
        Quantum optimization: Transposes matrix B to achieve row-based memory access,
        increasing cache locality to drastically speed up sum-product step within lists.
        Complexity: O(n * m * p)
        """
        if not A or not B or not A[0] or not B[0]:
            raise ValueError("Matrices cannot be empty.")

        rows_A, cols_A = len(A), len(A[0])
        rows_B, cols_B = len(B), len(B[0])

        if cols_A != rows_B:
            raise ValueError(f"Incompatible dimensions for multiplication: {cols_A} vs {rows_B}")

        # Transpose B for cache-friendly sequential row access
        B_T = [[B[j][i] for j in range(rows_B)] for i in range(cols_B)]

        return [
            [sum(a * b for a, b in zip(row_a, col_b)) for col_b in B_T]
            for row_a in A
        ]

    @staticmethod
    def sigmoid(x: Number) -> float:
        """
        Computes the activation Sigmoid function.
        Handles negative infinity boundaries to prevent exponential overflow.
        Complexity: O(1)
        """
        if x < -709:  # math.exp overflow prevention threshold
            return 0.0
        if x > 709:
            return 1.0
        return 1.0 / (1.0 + math.exp(-x))

    @staticmethod
    def calculate_entropy(probabilities: Vector) -> float:
        """
        Calculates Shannon Entropy (Information Theory metric of uncertainty).
        Complexity: O(n)
        """
        if not probabilities:
            raise ValueError("Probability vector cannot be empty.")
        
        sum_p = sum(probabilities)
        if not math.isclose(sum_p, 1.0, rel_tol=1e-5):
            # Normalize sequence if probabilities do not sum to 1.0
            probabilities = [p / sum_p for p in probabilities]

        return -sum(p * math.log2(p) for p in probabilities if p > 0.0)

    @staticmethod
    def variance(data: Vector) -> float:
        """
        Calculates sample variance for statistical optimization.
        Complexity: O(n)
        """
        n = len(data)
        if n < 2:
            return 0.0
        mean = sum(data) / n
        return sum((x - mean) ** 2 for x in data) / (n - 1)

    @staticmethod
    def std_dev(data: Vector) -> float:
        """
        Calculates the standard deviation.
        Complexity: O(n)
        """
        return math.sqrt(QuantumEngine.variance(data))

    @staticmethod
    def cosine_similarity(v1: Vector, v2: Vector) -> float:
        """
        Calculates Cosine Similarity, fundamental for indexing and semantic analysis.
        Complexity: O(n)
        """
        if len(v1) != len(v2):
            raise ValueError("Dimensions must match for cosine similarity.")
        
        dot = QuantumEngine.vector_dot(v1, v2)
        norm_a = math.sqrt(sum(x * x for x in v1))
        norm_b = math.sqrt(sum(x * x for x in v2))
        
        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0
        
        return dot / (norm_a * norm_b)
