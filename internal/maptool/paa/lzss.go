package paa

// decompressLZSS decompresses Bohemia Interactive's LZSS format.
// expectedSize is the expected uncompressed output size.
//
// Format: flag byte followed by 8 items (LSB first).
// Flag bit 1 = literal byte, 0 = 2-byte back-reference.
// Back-reference: byte0 = offset low 8 bits, byte1 upper nibble = offset high 4 bits,
// byte1 lower nibble = length - 3. Sliding window is 4096 bytes (12-bit offset).
func decompressLZSS(src []byte, expectedSize int) []byte {
	const windowSize = 4096
	const fillByte = 0x20

	dst := make([]byte, 0, expectedSize)
	var buf [windowSize]byte
	for i := range buf {
		buf[i] = fillByte
	}

	bufPos := 0
	srcPos := 0

	for srcPos < len(src) && len(dst) < expectedSize {
		if srcPos >= len(src) {
			break
		}
		flags := src[srcPos]
		srcPos++

		for bit := 0; bit < 8 && len(dst) < expectedSize; bit++ {
			if flags&(1<<bit) != 0 {
				// Literal byte
				if srcPos >= len(src) {
					return dst
				}
				b := src[srcPos]
				srcPos++
				dst = append(dst, b)
				buf[bufPos] = b
				bufPos = (bufPos + 1) % windowSize
			} else {
				// Back-reference: 2 bytes
				if srcPos+1 >= len(src) {
					return dst
				}
				b0 := int(src[srcPos])
				b1 := int(src[srcPos+1])
				srcPos += 2

				offset := b0 | ((b1 & 0xF0) << 4)
				length := (b1 & 0x0F) + 3

				for i := 0; i < length && len(dst) < expectedSize; i++ {
					b := buf[(offset+i)%windowSize]
					dst = append(dst, b)
					buf[bufPos] = b
					bufPos = (bufPos + 1) % windowSize
				}
			}
		}
	}

	return dst
}
