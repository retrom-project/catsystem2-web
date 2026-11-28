# Native D3D9 lines

The shared device accepts `D3DPT_LINELIST` and `D3DPT_LINESTRIP` for
pretransformed vertices without texture coordinates. It consumes the
original 20-byte XYZRHW and diffuse records, including indexed draws, and
keeps primitive order for depth, blending and stencil.

Aliased coverage uses 1/256-pixel endpoint adjustment and the reference
rasterizer's top-left rule. The browser shades the covered pixels with the
same device state as other primitives. Gouraud color interpolates along
the major screen axis with reciprocal W. Flat shading uses the first
vertex color. Viewport and scissor limit coverage. Antialiased lines share
the existing coverage shader. [Direct3D 9 rasterization rules](https://learn.microsoft.com/en-us/windows/win32/direct3d9/rasterization-rules),
[Mesa 22.3.6 source archive](https://archive.mesa3d.org/older-versions/22.x/mesa-22.3.6.tar.xz)

Run the original D3D9 probe with `scripts/native-ppi-d3d9-oracle.py --lines`
using the pinned Wine 8 and Mesa 22.3.6 image. The Chromium COM regression
compares every channel across 126 authored cases and requires exact pixel
coverage. The fixtures allow one 8-bit level of color rounding in the
listed Gouraud, blend and antialias cases. They also check source vertex
bytes and a fresh GPU restore. Textured lines and untransformed line
vertices remain unsupported.
