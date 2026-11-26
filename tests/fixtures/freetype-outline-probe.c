// SPDX-License-Identifier: MPL-2.0
// Optional private test build. None of these probe exports ship in the backend.
#include <stdlib.h>
#include <string.h>
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_GLYPH_H
#include FT_INTERNAL_OBJECTS_H

static unsigned probe_counts[4];
static int probe_fault;
static unsigned probe_faults;
static FT_Error probe_load(FT_Face face, FT_UInt index, FT_Int32 flags) {
  if (probe_fault == 4) {
    probe_fault = 0; probe_faults++; return FT_Err_Out_Of_Memory;
  }
  probe_counts[(flags & FT_LOAD_RENDER) ? 1 : 0]++;
  return FT_Load_Glyph(face, index, flags);
}
static FT_Error probe_get(FT_GlyphSlot slot, FT_Glyph *glyph) {
  if (probe_fault == 2) {
    probe_fault = 0; probe_faults++; return FT_Err_Out_Of_Memory;
  }
  probe_counts[2]++;
  return FT_Get_Glyph(slot, glyph);
}
static FT_Error probe_bitmap(FT_Glyph *glyph, FT_Render_Mode mode,
                             FT_Vector *origin, FT_Bool destroy) {
  if (probe_fault == 3) {
    probe_fault = 0; probe_faults++; return FT_Err_Out_Of_Memory;
  }
  probe_counts[3]++;
  return FT_Glyph_To_Bitmap(glyph, mode, origin, destroy);
}
static void *probe_alloc(size_t size) {
  if (probe_fault == 1) {
    probe_fault = 0; probe_faults++; return NULL;
  }
  return malloc(size);
}
#define CS2_FONT_LOAD_GLYPH probe_load
#define CS2_FONT_GET_GLYPH probe_get
#define CS2_FONT_TO_BITMAP probe_bitmap
#define CS2_FONT_CACHE_ALLOC probe_alloc
#ifndef CS2_FONT_PROBE_SOURCE
#define CS2_FONT_PROBE_SOURCE "../../third_party/freetype/native-font.c"
#endif
#include CS2_FONT_PROBE_SOURCE

int cs2_font_probe_stat(int key) {
  if (key >= 0 && key < 4) return (int)probe_counts[key];
  if (key == 7) return (int)probe_faults;
#ifndef CS2_FONT_PROBE_CONTROL
  if (key == 4) return (int)outline_count;
  if (key == 5) return (int)outline_bytes;
  if (key == 6) {
    int count = 0;
    OutlineEntry *entry;
    for (entry = outputs; entry; entry = entry->next) count++;
    return count;
  }
#endif
  return 0;
}
int cs2_font_probe_control(void *ptr, int operation, int value) {
  FT_Face face = (FT_Face)ptr;
  if (operation == 0) {
    memset(probe_counts, 0, sizeof(probe_counts));
    probe_fault = 0; probe_faults = 0; return 0;
  }
  if (operation == 1) { probe_fault = value; return 0; }
  if (!face) return -1;
  if (operation == 2) {
    FT_Matrix matrix = { 0x10000, 0, 0, 0x10000 };
    FT_Vector delta = { 0, 0 };
    if (value == 1) matrix.xy = 0x2000;
    if (value == 2) delta.x = 32;
    if (value == 3) { matrix.xx = matrix.yy = 0; matrix.xy = -0x10000; matrix.yx = 0x10000; }
    FT_Set_Transform(face, &matrix, &delta); return 0;
  }
  if (operation == 3) {
    if (value < 0 || value >= face->num_charmaps) return -1;
    return FT_Set_Charmap(face, face->charmaps[value]);
  }
  if (operation == 4) return face->num_charmaps;
  if (operation == 5) {
    const char *driver = face->driver->root.clazz->module_name;
    if (!strcmp(driver, "truetype")) return 1;
    if (!strcmp(driver, "cff")) return 2;
    if (!strcmp(driver, "bdf")) return 3;
    if (!strcmp(driver, "type1")) return 4;
    return 0;
  }
  return -1;
}
