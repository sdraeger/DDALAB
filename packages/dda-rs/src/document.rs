//! Result documents and `.npy` arrays.

/// The header of a version 1.0 `.npy` file holding C-order little-endian f64 values of `shape`:
/// magic, version, header length and the padded dict, ending in a newline at a multiple of 64 bytes.
pub fn npy_header(shape: &[usize]) -> Vec<u8> {
    let dims = match shape {
        [n] => format!("({n},)"),
        _ => format!(
            "({})",
            shape
                .iter()
                .map(usize::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        ),
    };
    let mut dict = format!("{{'descr': '<f8', 'fortran_order': False, 'shape': {dims}, }}");
    // The 10 bytes before the dict, and the newline after it.
    let padding = (64 - (10 + dict.len() + 1) % 64) % 64;
    dict.push_str(&" ".repeat(padding));
    dict.push('\n');

    let mut header = b"\x93NUMPY\x01\x00".to_vec();
    header.extend((dict.len() as u16).to_le_bytes());
    header.extend(dict.bytes());
    header
}

#[cfg(test)]
mod tests {
    use super::npy_header;

    #[test]
    fn npy_header_shapes_and_padding() {
        for (shape, dims) in [(&[5, 2][..], "(5, 2)"), (&[7], "(7,)"), (&[], "()")] {
            let header = npy_header(shape);
            assert_eq!(header.len() % 64, 0);
            let text = std::str::from_utf8(&header[10..]).unwrap();
            assert!(text.starts_with(&format!(
                "{{'descr': '<f8', 'fortran_order': False, 'shape': {dims}, }}"
            )));
            assert!(text.ends_with('\n'));
            assert_eq!(
                u16::from_le_bytes([header[8], header[9]]) as usize,
                text.len()
            );
        }
        // numpy's own header for a (5, 2) f8 array is 128 bytes.
        assert_eq!(npy_header(&[5, 2]).len(), 128);
    }
}
