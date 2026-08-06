# RNNoise Upstream

## Source

- Repository: https://github.com/xiph/rnnoise.git
- Release: `v0.1.1`
- Peeled commit: `6cbfd53eb348a8d394e0757b4025c6ded34eb2b6`
- Model: the classic small model embedded in upstream `src/rnn_data.c`

The release tag was resolved to the full peeled commit above. All vendored
license, public header, source, and private header files were copied without
modification from that commit. No external model archive is used.

## Vendored Scope

The vendored files are:

- `COPYING`
- `include/rnnoise.h`
- The seven library sources listed by upstream `Makefile.am`:
  `denoise.c`, `rnn.c`, `rnn_data.c`, `rnn_reader.c`, `pitch.c`,
  `kiss_fft.c`, and `celt_lpc.c`
- Their transitive private headers:
  `arch.h`, `celt_lpc.h`, `common.h`, `_kiss_fft_guts.h`, `kiss_fft.h`,
  `opus_types.h`, `pitch.h`, `rnn_data.h`, `rnn.h`, and `tansig_table.h`

Repository metadata, training code, examples, generated build files, and
architecture-specific source trees are excluded. `CMakeLists.txt` and this
file are local integration metadata.

## License

RNNoise v0.1.1 is distributed under the BSD 3-Clause license. See `COPYING`
for the complete copyright notice, conditions, and disclaimer.
