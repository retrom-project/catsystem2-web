// SPDX-License-Identifier: MPL-2.0
#include <stdlib.h>
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_MODULE_H
static FT_Library library;
void *cs2_font_open(const unsigned char *bytes,int size,int index){
 FT_Face face=0;if(!library){if(FT_Init_FreeType(&library))return 0;
 #if FREETYPE_MINOR >= 7
 // The reviewed 2.7.1 image uses the original TrueType interpreter (35).
 unsigned interpreter=35;FT_Property_Set(library,"truetype","interpreter-version",&interpreter);
#endif
 }
 if(FT_New_Memory_Face(library,bytes,size,index,&face))return 0;return face;
}
void cs2_font_close(void *face){if(face)FT_Done_Face((FT_Face)face);}
int cs2_font_advance(void *ptr,int size,unsigned code){
 FT_Face face=(FT_Face)ptr;if(!face||FT_Set_Pixel_Sizes(face,0,size))return 0;
 FT_UInt index=FT_Get_Char_Index(face,code);if(!index||FT_Load_Glyph(face,index,FT_LOAD_DEFAULT))return 0;
 return face->glyph->advance.x>>6;
}
int cs2_font_glyph(void *ptr,int size,unsigned code,int *out){
 FT_Face face=(FT_Face)ptr;if(!face||FT_Set_Pixel_Sizes(face,0,size))return 0;
 FT_UInt index=FT_Get_Char_Index(face,code);if(!index||FT_Load_Glyph(face,index,FT_LOAD_RENDER))return 0;
 FT_GlyphSlot slot=face->glyph;out[0]=slot->bitmap.width;out[1]=slot->bitmap.rows;
 out[2]=slot->bitmap_left;out[3]=slot->bitmap_top;out[4]=slot->advance.x>>6;
 out[5]=(int)slot->bitmap.buffer;out[6]=slot->bitmap.pitch;out[7]=slot->bitmap.pixel_mode;
 return 1;
}
