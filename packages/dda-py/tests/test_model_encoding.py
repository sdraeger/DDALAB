"""
Tests for model_encoding module
"""

import pytest
from dda_py.model_encoding import (
    generate_monomials,
    monomial_to_text,
    monomial_to_latex,
    decode_model_encoding,
    visualize_model_space,
    model_encoding_to_dict,
)


class TestMonomialGeneration:
    """Test monomial generation for different configurations"""

    def test_two_delays_order_two(self):
        """Test the user's example: 2 delays, order 2"""
        monomials = generate_monomials(num_delays=2, polynomial_order=2)

        # Should generate exactly the sequence from user's example
        expected = [
            (0, 1),  # x_1
            (0, 2),  # x_2
            (1, 1),  # x_1^2
            (1, 2),  # x_1 * x_2
            (2, 2),  # x_2^2
        ]

        assert monomials == expected
        assert len(monomials) == 5

    def test_three_delays_order_two(self):
        """Test 3 delays, order 2"""
        monomials = generate_monomials(num_delays=3, polynomial_order=2)

        expected = [
            (0, 1), (0, 2), (0, 3),  # Linear terms
            (1, 1), (1, 2), (1, 3), (2, 2), (2, 3), (3, 3),  # Quadratic terms
        ]

        assert monomials == expected
        assert len(monomials) == 9

    def test_two_delays_order_three(self):
        """Test 2 delays, order 3"""
        monomials = generate_monomials(num_delays=2, polynomial_order=3)

        expected = [
            (0, 1), (0, 2),  # Degree 1
            (1, 1), (1, 2), (2, 2),  # Degree 2
            (1, 1, 1), (1, 1, 2), (1, 2, 2), (2, 2, 2),  # Degree 3
        ]

        assert monomials == expected
        assert len(monomials) == 9


class TestMonomialToText:
    """Test conversion of monomials to text representation"""

    def test_linear_terms(self):
        """Test linear term formatting"""
        assert monomial_to_text((0, 1)) == "x_1"
        assert monomial_to_text((0, 2)) == "x_2"
        assert monomial_to_text((0, 3)) == "x_3"

    def test_quadratic_terms(self):
        """Test quadratic term formatting"""
        assert monomial_to_text((1, 1)) == "x_1^2"
        assert monomial_to_text((1, 2)) == "x_1 * x_2"
        assert monomial_to_text((2, 2)) == "x_2^2"

    def test_cubic_terms(self):
        """Test cubic term formatting"""
        assert monomial_to_text((1, 1, 1)) == "x_1^3"
        assert monomial_to_text((1, 1, 2)) == "x_1^2 * x_2"
        assert monomial_to_text((1, 2, 2)) == "x_1 * x_2^2"
        assert monomial_to_text((2, 2, 2)) == "x_2^3"

    def test_with_tau_values(self):
        """Test formatting with actual tau values"""
        assert monomial_to_text((0, 1), tau_values=[1.5, 2.0]) == "x(t - 1.5)"
        assert monomial_to_text((1, 1), tau_values=[1.5, 2.0]) == "x(t - 1.5)^2"
        assert monomial_to_text((1, 2), tau_values=[1.5, 2.0]) == "x(t - 1.5) * x(t - 2.0)"


class TestMonomialToLatex:
    """Test conversion of monomials to LaTeX representation"""

    def test_linear_terms(self):
        """Test linear term LaTeX formatting"""
        assert monomial_to_latex((0, 1)) == "x_{1}"
        assert monomial_to_latex((0, 2)) == "x_{2}"

    def test_quadratic_terms(self):
        """Test quadratic term LaTeX formatting"""
        assert monomial_to_latex((1, 1)) == "x_{1}^{2}"
        assert monomial_to_latex((1, 2)) == "x_{1} x_{2}"
        assert monomial_to_latex((2, 2)) == "x_{2}^{2}"

    def test_with_tau_values(self):
        """Test LaTeX with actual tau values"""
        assert monomial_to_latex((0, 1), tau_values=[1.5, 2.0]) == "x(t - 1.5)"
        assert monomial_to_latex((1, 1), tau_values=[1.5, 2.0]) == "x(t - 1.5)^{2}"


class TestDecodeModelEncoding:
    """Test decoding of model encodings to equations"""

    def test_user_example(self):
        """Test the exact example from user: [1 3 5] with 2 delays, order 2"""
        equation_text = decode_model_encoding(
            model_encoding=[1, 3, 5],
            num_delays=2,
            polynomial_order=2,
            format="text"
        )

        # Should produce: dx/dt = a_1 x_1 + a_2 x_1^2 + a_3 x_2^2
        assert "dx/dt" in equation_text
        assert "a_1 x_1" in equation_text
        assert "a_2 x_1^2" in equation_text
        assert "a_3 x_2^2" in equation_text

    def test_user_example_latex(self):
        """Test LaTeX output for user's example"""
        equation_latex = decode_model_encoding(
            model_encoding=[1, 3, 5],
            num_delays=2,
            polynomial_order=2,
            format="latex"
        )

        assert "\\dot{x}" in equation_latex
        assert "a_{1} x_{1}" in equation_latex
        assert "a_{2} x_{1}^{2}" in equation_latex
        assert "a_{3} x_{2}^{2}" in equation_latex

    def test_all_linear_terms(self):
        """Test model with only linear terms"""
        equation_text = decode_model_encoding(
            model_encoding=[1, 2],
            num_delays=2,
            polynomial_order=2,
            format="text"
        )

        assert "a_1 x_1" in equation_text
        assert "a_2 x_2" in equation_text

    def test_with_tau_values(self):
        """Test decoding with actual tau values"""
        equation_text = decode_model_encoding(
            model_encoding=[1, 3, 5],
            num_delays=2,
            polynomial_order=2,
            tau_values=[1.0, 2.0],
            format="text"
        )

        assert "x(t - 1.0)" in equation_text
        assert "x(t - 2.0)" in equation_text

    def test_invalid_index_raises_error(self):
        """Test that invalid indices raise ValueError"""
        with pytest.raises(ValueError, match="Invalid model index"):
            decode_model_encoding(
                model_encoding=[1, 99],
                num_delays=2,
                polynomial_order=2,
                format="text"
            )


class TestVisualizeModelSpace:
    """Test model space visualization"""

    def test_basic_visualization(self):
        """Test basic visualization output"""
        output = visualize_model_space(num_delays=2, polynomial_order=2)

        assert "Model Space: 2 delays, order 2" in output
        assert "Total monomials: 5" in output
        assert "[0, 1]" in output
        assert "[2, 2]" in output

    def test_with_highlighting(self):
        """Test visualization with highlighted terms"""
        output = visualize_model_space(
            num_delays=2,
            polynomial_order=2,
            highlight_encoding=[1, 3, 5]
        )

        assert "Selected terms" in output
        assert "*" in output  # Marker for selected terms
        assert "dx/dt" in output  # Equation should be shown

    def test_with_tau_values(self):
        """Test visualization with tau values"""
        output = visualize_model_space(
            num_delays=2,
            polynomial_order=2,
            tau_values=[1.5, 2.0]
        )

        assert "τ_1=1.5" in output
        assert "τ_2=2.0" in output


class TestModelEncodingToDict:
    """Test structured dictionary output"""

    def test_basic_dict_structure(self):
        """Test dictionary structure"""
        result = model_encoding_to_dict(
            model_encoding=[1, 3, 5],
            num_delays=2,
            polynomial_order=2
        )

        assert 'equation_latex' in result
        assert 'equation_text' in result
        assert 'num_terms' in result
        assert 'terms' in result
        assert result['num_terms'] == 3
        assert len(result['terms']) == 3

    def test_term_details(self):
        """Test individual term details"""
        result = model_encoding_to_dict(
            model_encoding=[1, 3, 5],
            num_delays=2,
            polynomial_order=2
        )

        # First term: a_1 x_1
        assert result['terms'][0]['coefficient'] == 'a_1'
        assert result['terms'][0]['monomial'] == [0, 1]
        assert result['terms'][0]['term_text'] == 'x_1'

        # Second term: a_2 x_1^2
        assert result['terms'][1]['coefficient'] == 'a_2'
        assert result['terms'][1]['monomial'] == [1, 1]
        assert result['terms'][1]['term_text'] == 'x_1^2'

        # Third term: a_3 x_2^2
        assert result['terms'][2]['coefficient'] == 'a_3'
        assert result['terms'][2]['monomial'] == [2, 2]
        assert result['terms'][2]['term_text'] == 'x_2^2'


class TestEdgeCases:
    """Test edge cases and boundary conditions"""

    def test_single_delay_order_one(self):
        """Test minimal case: 1 delay, order 1"""
        monomials = generate_monomials(num_delays=1, polynomial_order=1)
        assert monomials == [(0, 1)]

    def test_many_delays(self):
        """Test with many delays"""
        monomials = generate_monomials(num_delays=5, polynomial_order=1)
        assert len(monomials) == 5  # Just linear terms

    def test_high_order(self):
        """Test with high polynomial order"""
        monomials = generate_monomials(num_delays=2, polynomial_order=4)
        # Count: 2 (deg 1) + 3 (deg 2) + 4 (deg 3) + 5 (deg 4) = 14
        assert len(monomials) == 14
