// SPDX-License-Identifier: MPL-2.0
// Reuse a bounded owned hinted outline between measurement and rasterization.
// Bitmap rendering stays in cs2_font_glyph; JS glyph maps keep their usual timing.
#include <stdlib.h>
#include <string.h>
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_MODULE_H
#include FT_GLYPH_H
#include FT_INTERNAL_OBJECTS_H

// Test probes can inject allocation failures and count actual library loads.
// The production builder keeps these direct original FreeType/CRT calls.
#ifndef CS2_FONT_LOAD_GLYPH
#define CS2_FONT_LOAD_GLYPH FT_Load_Glyph
#endif
#ifndef CS2_FONT_GET_GLYPH
#define CS2_FONT_GET_GLYPH FT_Get_Glyph
#endif
#ifndef CS2_FONT_TO_BITMAP
#define CS2_FONT_TO_BITMAP FT_Glyph_To_Bitmap
#endif
#ifndef CS2_FONT_CACHE_ALLOC
#define CS2_FONT_CACHE_ALLOC malloc
#endif
#ifndef CS2_FONT_OUTLINE_CACHE
#define CS2_FONT_OUTLINE_CACHE 1
#endif

static FT_Library library;
typedef struct OutlineEntry_ {
  struct OutlineEntry_ *next;
  FT_Face face;
  FT_CharMap charmap;
  FT_UInt index;
  int size;
  FT_UShort x_ppem, y_ppem;
  FT_Fixed x_scale, y_scale;
  FT_Glyph glyph;
  size_t bytes;
} OutlineEntry;
static OutlineEntry *outlines;
static unsigned outline_count;
static size_t outline_bytes;
static OutlineEntry *outputs;
#define OUTLINE_ENTRIES 128
#define OUTLINE_BYTES (2u * 1024u * 1024u)

static void release_output(FT_Face face) {
  OutlineEntry **link = &outputs;
  while (*link) {
    OutlineEntry *entry = *link;
    if (entry->face == face) {
      *link = entry->next;
      FT_Done_Glyph(entry->glyph);
      free(entry);
    } else link = &entry->next;
  }
}
static void remove_entry(OutlineEntry **link) {
  OutlineEntry *entry = *link;
  *link = entry->next;
  outline_count--;
  outline_bytes -= entry->bytes;
  FT_Done_Glyph(entry->glyph);
  free(entry);
}
static void release_outlines(void) {
  while (outlines) remove_entry(&outlines);
}
static int reusable_face(FT_Face face) {
  const char *driver = face->driver->root.clazz->module_name;
  if (!strcmp(driver, "truetype")) return 1;
#if FREETYPE_MAJOR == 2 && FREETYPE_MINOR == 7 && !defined(CFF_CONFIG_OPTION_OLD_ENGINE)
  // The pinned Adobe CFF engine has no stateful random operator. The older
  // CFF/Type1 interpreters are deliberately outside this ownership proof.
  if (!strcmp(driver, "cff")) return 1;
#endif
  return 0;
}
static int same_key(OutlineEntry *e, FT_Face face, int size, FT_UInt index) {
  FT_Size_Metrics *m = &face->size->metrics;
  return e->face == face && e->size == size && e->index == index &&
    e->charmap == face->charmap && e->x_ppem == m->x_ppem &&
    e->y_ppem == m->y_ppem && e->x_scale == m->x_scale && e->y_scale == m->y_scale;
}
static void discard_incompatible(FT_Face face, int size) {
  OutlineEntry **link = &outlines;
  while (*link) {
    OutlineEntry *e = *link;
    if (e->face == face && (!reusable_face(face) || face->internal->transform_flags ||
        !same_key(e, face, size, e->index))) remove_entry(link);
    else link = &e->next;
  }
}
static FT_Error prepare_size(FT_Face face, int size) {
  FT_Error error = FT_Set_Pixel_Sizes(face, 0, size);
  if (error == FT_Err_Out_Of_Memory && outlines) {
    release_outlines();
    error = FT_Set_Pixel_Sizes(face, 0, size);
  }
  if (!error) discard_incompatible(face, size);
  return error;
}
static void remember_outline(FT_Face face, int size, FT_UInt index) {
  FT_Glyph glyph = 0;
  FT_OutlineGlyph outline;
  OutlineEntry *entry, **link;
  size_t bytes;
  FT_Size_Metrics *m;
  if (!CS2_FONT_OUTLINE_CACHE) return;
  // Bitmap/other formats keep the existing ordinary glyph load/render path.
  if (!reusable_face(face) || face->internal->transform_flags ||
      face->glyph->format != FT_GLYPH_FORMAT_OUTLINE ||
      CS2_FONT_GET_GLYPH(face->glyph, &glyph))
    return;
  outline = (FT_OutlineGlyph)glyph;
  if (outline->outline.n_points < 0 || outline->outline.n_contours < 0) {
    FT_Done_Glyph(glyph); return;
  }
  bytes = sizeof(OutlineEntry) + sizeof(FT_OutlineGlyphRec) +
    (size_t)outline->outline.n_points * (sizeof(FT_Vector) + 1u) +
    (size_t)outline->outline.n_contours * sizeof(short);
  if (bytes > OUTLINE_BYTES) { FT_Done_Glyph(glyph); return; }
  entry = (OutlineEntry *)CS2_FONT_CACHE_ALLOC(sizeof(OutlineEntry));
  if (!entry) { FT_Done_Glyph(glyph); return; }
  for (link = &outlines; *link;) {
    if (same_key(*link, face, size, index)) remove_entry(link);
    else link = &(*link)->next;
  }
  m = &face->size->metrics;
  entry->face = face; entry->size = size; entry->index = index;
  entry->charmap = face->charmap; entry->x_ppem = m->x_ppem; entry->y_ppem = m->y_ppem;
  entry->x_scale = m->x_scale; entry->y_scale = m->y_scale;
  entry->glyph = glyph; entry->bytes = bytes; entry->next = outlines;
  outlines = entry; outline_count++; outline_bytes += bytes;
  while (outline_count > OUTLINE_ENTRIES || outline_bytes > OUTLINE_BYTES) {
    link = &outlines;
    while ((*link)->next) link = &(*link)->next;
    remove_entry(link);
  }
}
static OutlineEntry *take_outline(FT_Face face, int size, FT_UInt index) {
  OutlineEntry **link = &outlines;
  while (*link) {
    OutlineEntry *entry = *link;
    if (same_key(entry, face, size, index)) {
      *link = entry->next; outline_count--; outline_bytes -= entry->bytes;
      return entry;
    }
    link = &entry->next;
  }
  return 0;
}
void *cs2_font_open(const unsigned char *bytes, int size, int index) {
  FT_Face face = 0;
  if (!library) {
    if (FT_Init_FreeType(&library)) return 0;
#if FREETYPE_MINOR >= 7
    unsigned interpreter = 35;
    FT_Property_Set(library, "truetype", "interpreter-version", &interpreter);
#endif
  }
  if (FT_New_Memory_Face(library, bytes, size, index, &face)) return 0;
  return face;
}
void cs2_font_close(void *ptr) {
  FT_Face face = (FT_Face)ptr;
  OutlineEntry **link = &outlines;
  if (!face) return;
  release_output(face);
  while (*link) {
    if ((*link)->face == face) remove_entry(link);
    else link = &(*link)->next;
  }
  FT_Done_Face(face);
}
int cs2_font_advance(void *ptr, int size, unsigned code) {
  FT_Face face = (FT_Face)ptr;
  FT_UInt index;
  FT_Error error;
  if (!face || prepare_size(face, size)) return 0;
  index = FT_Get_Char_Index(face, code);
  if (!index) return 0;
  release_output(face);
  // Measurement still loads the requested glyph and preserves its ordinary
  // face slot. A bounded owned outline copy may serve a later bitmap request.
  error = CS2_FONT_LOAD_GLYPH(face, index, FT_LOAD_DEFAULT);
  if (error == FT_Err_Out_Of_Memory && outlines) {
    release_outlines(); error = CS2_FONT_LOAD_GLYPH(face, index, FT_LOAD_DEFAULT);
  }
  if (error) return 0;
  remember_outline(face, size, index);
  return face->glyph->advance.x >> 6;
}
int cs2_font_glyph(void *ptr, int size, unsigned code, int *out) {
  FT_Face face = (FT_Face)ptr;
  FT_UInt index;
  FT_Glyph glyph;
  OutlineEntry *entry;
  FT_GlyphSlot slot;
  FT_Error error;
  if (!face || prepare_size(face, size)) return 0;
  index = FT_Get_Char_Index(face, code);
  if (!index) return 0;
  release_output(face);
  entry = face->internal->transform_flags ? 0 : take_outline(face, size, index);
  if (entry) {
    glyph = entry->glyph;
    if (!CS2_FONT_TO_BITMAP(&glyph, FT_RENDER_MODE_NORMAL, 0, 1)) {
      FT_BitmapGlyph bitmap = (FT_BitmapGlyph)glyph;
      entry->glyph = glyph; entry->next = outputs; outputs = entry;
      out[0] = bitmap->bitmap.width; out[1] = bitmap->bitmap.rows;
      out[2] = bitmap->left; out[3] = bitmap->top; out[4] = glyph->advance.x >> 16;
      out[5] = (int)bitmap->bitmap.buffer; out[6] = bitmap->bitmap.pitch;
      out[7] = bitmap->bitmap.pixel_mode;
      return 1;
    }
    FT_Done_Glyph(glyph); free(entry);
    release_outlines();
  }
  // Allocation, unsupported format, eviction or render failure recomputes the
  // ordinary complete request. No legal text/font input is truncated.
  error = CS2_FONT_LOAD_GLYPH(face, index, FT_LOAD_RENDER);
  if (error == FT_Err_Out_Of_Memory && outlines) {
    release_outlines(); error = CS2_FONT_LOAD_GLYPH(face, index, FT_LOAD_RENDER);
  }
  if (error) return 0;
  slot = face->glyph;
  out[0] = slot->bitmap.width; out[1] = slot->bitmap.rows;
  out[2] = slot->bitmap_left; out[3] = slot->bitmap_top; out[4] = slot->advance.x >> 6;
  out[5] = (int)slot->bitmap.buffer; out[6] = slot->bitmap.pitch;
  out[7] = slot->bitmap.pixel_mode;
  return 1;
}
