/* SPDX-License-Identifier: MPL-2.0 */
/* Recovered buffer/termination contract around the unmodified zlib 1.2.3 API.
 * The engine retains an untouched destination tail when input is exhausted,
 * and zero-fills it when inflate stops producing output with input remaining.
 */
#include <string.h>
#include "zlib.h"
int cs2_inflate(unsigned char *destination, int capacity,
                unsigned char const *source, unsigned int length) {
  z_stream stream;
  unsigned char block[4096];
  int written = 0;
  memset(&stream, 0, sizeof(stream));
  if (inflateInit(&stream) != Z_OK) return -1;
  stream.next_in = (Bytef *)source;
  stream.avail_in = length;
  while (length) {
    unsigned int produced;
    stream.next_out = block;
    stream.avail_out = sizeof(block);
    inflate(&stream, Z_NO_FLUSH);
    produced = sizeof(block) - stream.avail_out;
    if (!produced) {
      memset(destination + written, 0, capacity - written);
      break;
    }
    if (produced > (unsigned int)(capacity - written)) produced = capacity - written;
    memcpy(destination + written, block, produced);
    written += produced;
    if (!stream.avail_in) break;
  }
  inflateEnd(&stream);
  return written;
}

/* Original 82C3C0/869CE0 level-9 encoder, including whole-block capacity
 * checks and total output count when a destination block does not fit. */
int cs2_deflate(unsigned char *destination, int capacity,
                unsigned char const *source, unsigned int length) {
  z_stream stream;
  unsigned char block[65536];
  int written = 0, result;
  memset(&stream, 0, sizeof(stream));
  if (deflateInit(&stream, 9) != Z_OK) return -1;
  stream.next_in = (Bytef *)source;
  stream.avail_in = length;
  if (length) {
    do {
      unsigned int produced;
      stream.next_out = block;
      stream.avail_out = sizeof(block);
      result = deflate(&stream, Z_NO_FLUSH);
      if (result != Z_OK) { deflateEnd(&stream); return -1; }
      produced = sizeof(block) - stream.avail_out;
      if (written + (int)produced <= capacity)
        memcpy(destination + written, block, produced);
      written += produced;
    } while (stream.avail_in);
  }
  do {
    unsigned int produced;
    stream.next_out = block;
    stream.avail_out = sizeof(block);
    result = deflate(&stream, Z_FINISH);
    if (result != Z_OK && result != Z_STREAM_END) { deflateEnd(&stream); return -1; }
    produced = sizeof(block) - stream.avail_out;
    if (written + (int)produced <= capacity)
      memcpy(destination + written, block, produced);
    written += produced;
  } while (result != Z_STREAM_END);
  deflateEnd(&stream);
  return written;
}
