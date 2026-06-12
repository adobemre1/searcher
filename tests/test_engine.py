import pytest
import math
from src.quantum_core.engine import QuantumEngine

def test_matrix_multiplication():
    # Identity matrix multiplication test
    A = [[1, 2], [3, 4]]
    B = [[1, 0], [0, 1]] 
    result = QuantumEngine.matrix_multiply(A, B)
    assert result == [[1, 2], [3, 4]]

    # Arbitrary matrix multiplication test
    C = [[1, 2, 3], [4, 5, 6]]
    D = [[7, 8], [9, 10], [11, 12]]
    # (1*7 + 2*9 + 3*11) = 7 + 18 + 33 = 58
    # (1*8 + 2*10 + 3*12) = 8 + 20 + 36 = 64
    # (4*7 + 5*9 + 6*11) = 28 + 45 + 66 = 139
    # (4*8 + 5*10 + 6*12) = 32 + 50 + 72 = 154
    assert QuantumEngine.matrix_multiply(C, D) == [[58, 64], [139, 154]]

def test_entropy_calculation():
    # Equal probability coin toss -> 1 bit entropy
    probs = [0.5, 0.5]
    assert math.isclose(QuantumEngine.calculate_entropy(probs), 1.0)
    
    # 100% certainty -> 0 entropy
    assert math.isclose(QuantumEngine.calculate_entropy([1.0, 0.0]), 0.0)

def test_optimization_logic():
    # Dot product logic check
    v1 = [1, 2, 3]
    v2 = [4, 5, 6]
    # 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    assert QuantumEngine.vector_dot(v1, v2) == 32

def test_sigmoid_boundaries():
    # Sigmoid of 0 is 0.5
    assert math.isclose(QuantumEngine.sigmoid(0), 0.5)
    # Boundary tests to prevent overflow errors
    assert QuantumEngine.sigmoid(-1000) == 0.0
    assert QuantumEngine.sigmoid(1000) == 1.0

def test_cosine_similarity():
    # Identical vectors -> similarity 1
    v1 = [1, 2, 3]
    assert math.isclose(QuantumEngine.cosine_similarity(v1, v1), 1.0)
    
    # Orthogonal vectors -> similarity 0
    v3 = [1, 0]
    v4 = [0, 1]
    assert math.isclose(QuantumEngine.cosine_similarity(v3, v4), 0.0)

def test_variance_and_std_dev():
    data = [2, 4, 4, 4, 5, 5, 7, 9]
    # mean = (2+4+4+4+5+5+7+9)/8 = 40 / 8 = 5
    # variance = ((2-5)^2 + 3*(4-5)^2 + 2*(5-5)^2 + (7-5)^2 + (9-5)^2) / 7
    #          = (9 + 3 + 0 + 4 + 16) / 7 = 32 / 7 = 4.5714
    var = QuantumEngine.variance(data)
    assert math.isclose(var, 32.0 / 7.0, rel_tol=1e-5)
    assert math.isclose(QuantumEngine.std_dev(data), math.sqrt(32.0 / 7.0), rel_tol=1e-5)
