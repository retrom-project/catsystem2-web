# Native movies

The native movie service implements main `0x109..0x10E`, `0x1A1`, `0x314`,
`0x3E4..0x3E6`. It keeps each movie's preparation, running word, repeat count,
volume, rectangle, window mode and signed 100-nanosecond position independently.
Movie handles belong to the World, including during candidate checkpoint restore.

Opening routes the original root/InputTask messages and changes the shared view
cursor gate and renderer gate. A failed open undoes those changes. Close releases
the decoder, restores the gates, shows the cursor and sends the InputTask message
again. A disabled movie returns zero before formatting or creating a decoder.
The original InputTask platform message is an evidenced no-op; the message still
travels through the task router.

Play sets the running word before invoking the decoder. A failed graph Run
therefore leaves the running query true until stop succeeds. The second play
argument is a repeat count. Completion decrements it unless it is `0xFFFFFFFF`;
zero after decrement stops playback. An initial zero wraps to `0xFFFFFFFF`.
Completion events and native calls share a serialized queue. Frames and portable
checkpoint export wait for that queue; asynchronous decoder errors are reported.

Volume retains the original signed input and hundredths-of-decibel conversion.
When the window is inactive it uses the derived legacy BGM factor, or zero for
the original master/BGM mute gates. Active-window calls keep the supplied volume.
The browser applies the resulting attenuation to its media element.

Browser media replaces the DirectShow decoder and child window. Each movie owns
its own element and optional Blob URL. Restore opens a fresh decoder, waits for
the saved position to become seekable, seeks, and defers presentation/playback
until the candidate World becomes active. A source that cannot seek to the saved
position fails restoration; a silently reset time is not accepted.

`prepare:media` converts WMV/AVI/MPEG resources outside the original game tree.
Its provenance records the complete source identity, qualified archive aliases,
source size/SHA-256 and output SHA-256. The development server verifies output
hashes before exposing sidecars; the client checks the mounted identity and
resource size. Same-named resources in different archives remain independent.
Native browser formats can stream loose HTTP files directly or use an isolated,
revocable Blob URL for an archive slice. Missing browser codecs are reported as
an open failure; browser-native WMV decoding is not claimed.

`scripts/verify-native-movie.mjs` supplies **5,844 comparisons per frozen build,
11,688 total**. It executes all eleven original wrappers plus constructors,
play/stop, position, volume, rectangle, mode, destructor and completion-thread
helpers. Decoder open, COM methods, window/input routing, foreground state and
view gates are explicit boundaries. The completion wait supplies one event and
captures the repeating state before ending the diagnostic wait.

Public tests cover failure states, simultaneous handles, portable restore,
source/provenance isolation, and real Chromium decoding of an authored WebM.
The browser test checks decoded pixels, nonzero 440 Hz PCM, geometry, repeat
completion and fresh-decoder continuation at the saved position. It does not
establish Windows decoder pixel equality or the original renderer's complete
movie gate behavior; those remain separate acceptance items.

A second browser test runs authored KCS through the complete `CatSystem2`
instance for both frozen profiles. It checks the root/InputTask routing,
cursor/update gates, normal renderer suppression, live movie handles across
fresh World restore, old World disposal and explicit decoder close.

## Native workers for plane movies

The original CThread start and destructor run in the mounted engine. The
shared `engine-workers` feature schedules the reviewed callbacks at the
CRT `_beginthreadex` boundary. It also owns the existing retained-image
worker. Native thread exit queries and closes use the same handle service.

The movie MemStream in each profile prefetches three 4 MiB blocks using its
original reader, file cursor and ring. When the native reader sleeps for a
missing block, the original producer runs one iteration. The completion
callback also runs one iteration at a time. Its original code owns the
running word, repeat count, rewind and restart. The host preserves the
parked handles across fresh restore, with buffer contents and cursors
in the guest checkpoint.

After a rewind, the original completion worker polls `GetState` again
while the filter graph reports Running. At that branch the worker
returns through the original epilogue and saves its pending poll. On
resume the original prologue rebuilds the stack and owner register,
then continues at the state query. The saved stop flag still takes
the original exit path. The two-profile tests cover a fresh restore at
the pending query, an unchanged Running result, resumption after an
actual state change and the original stop/join path.

The two-profile worker tests read and seek across block boundaries and verify
the live allocation and lock counts after native destruction. A supplied
DirectShow event and control boundary exercises completion, repeat,
terminal exit and stop after a fresh restore. The VMR9 filter and texture
presentation path are separate platform work. [VMR-9 allocator-presenter
contract](https://learn.microsoft.com/en-us/windows/win32/directshow/supplying-a-custom-allocator-presenter-for-vmr-9)

## Shared D3D surface transfers for VMR9

The original SimplePlane receiver's movie message is decimal 43 in 2.6.1.76
and 41 in SDK 4.01. Both allocator-presenters query the decoder surface for
its Texture9 container, acquire level zero and call `StretchRect` with
null rectangles and `D3DTEXF_NONE`. An independent decoder surface is sent
directly when there is no texture. The presenter releases all the temporary
surface and container references. The frozen callbacks are `0x6867D0`
and `0x55D2B0`, respectively.

The shared device's `GetContainer` returns the actual texture through
`QueryInterface`, including its added reference. Stand-alone surfaces
expose their device per the Win32 contract. The pinned Wine 8 build instead
returns `E_NOINTERFACE` with an untouched output for explicitly created
stand-alone surfaces. The Texture9 query fails under either stand-alone surface behavior.
The implicit back buffer belongs to a swap chain. A successful query for
that container still requires the swap chain interface.
[GetContainer contract](https://learn.microsoft.com/en-us/windows/win32/api/d3d9/nf-d3d9-idirect3dsurface9-getcontainer)

`StretchRect` transfers default-pool A8R8G8B8 and X8R8G8B8 color surfaces
with full or bounded rectangles and NONE, POINT or LINEAR filters. A
partial write synchronizes live GPU pixels before updating the same guest
storage and GPU target. It preserves the pixels outside the destination
rectangle and the active target, viewport and depth binding. The adapter
reports its texture-source and point/linear filter caps. YUV, depth,
multisampling and other surface formats remain outside this transfer path.
[StretchRect contract](https://learn.microsoft.com/en-us/windows/win32/api/d3d9/nf-d3d9-idirect3ddevice9-stretchrect)

The authored surface oracle captures 48 container queries and 37 transfers
in pinned Wine. The checks compare texture identity and release counts,
rectangular alpha and color transfer, failure results and untouched pixels.
The same-surface scaling and render-target or texture-to-offscreen cases
follow the documented restrictions and the upstream Windows conformance
expectations, which differ from the Wine 8 results. Linear samples allow
one channel step of rounding. Nearest samples allow adjacent texels only
at exact ties. [Wine D3D9 conformance tests](https://github.com/wine-mirror/wine/blob/master/dlls/d3d9/tests/device.c)

The two-profile tests execute each original `PresentImage` vtable entry
using authored decoder surfaces and the shared D3D device. Chromium checks
the resulting asymmetric pixels, alpha and a second frame after fresh
restore. These tests supply surfaces at the presenter boundary. The
filter graph connection is exercised separately below.

## VMR9 allocator negotiation

The shared `vmr9` feature implements the allocator's Notify interface. It
queries the original allocator for its presenter and retains both native
interfaces. The original `AdviseNotify` supplies the renderer's device and
monitor. `AllocateSurfaceHelper` creates the requested texture, offscreen
or render-target surfaces on that device. The allocation honors the
requested and minimum buffer counts. Failure to meet the minimum releases
all surfaces allocated for that request.
[AllocateSurfaceHelper contract](<https://learn.microsoft.com/en-us/previous-versions/ms787121(v=vs.85)>)

The original `InitializeDevice` still computes the power-of-two surface
dimensions, display rectangle and fallback flags. The browser receives a
reference to each allocated surface through the original `GetSurface`.
It calls the original presenter for start, frame delivery and stop. Device
renegotiation and disconnection run the original termination callback and
release the acquired references. Checkpoints retain the existing guest
COM identities and shared device pixels, including while presenting.

The pinned Wine 8 probe covers 20 allocator requests, including texture
and plain-surface pools, count validation, conflicting flags and display
format negotiation. Pixel format availability follows the shared D3D
device. For example, the browser reports its unsupported-format HRESULT
for YUY2. DXVA allocation and an external D3D device or monitor remain
unsupported. Events route to the containing graph's registered sink.
[VMR9 interface definitions](https://github.com/wine-mirror/wine/blob/master/include/vmr9.idl)

Both frozen profiles run the original allocator and presenter in a
mounted Chromium World. An asymmetric 3×5 frame reaches the original 4×8
texture with its padding intact. The checks cover three buffers,
continuation after fresh restore, device renegotiation, the original
offscreen fallback, and release of guest allocations and COM references.
The frames in these tests are supplied directly at the decoder surface.

## Native source reader events

The movie source filter constructs its own DirectShow `CAsyncReader`
over the original MemStream. The reader creates four unnamed Win32
events. The shared Windows kernel preserves their manual or automatic
reset state and their live handle identities. It supports single waits,
non-alertable extended waits, wait-any, wait-all and timeouts. A wait-all
consumes automatic events only once every requested event is signaled.
The original reader destructor closes these handles through the same
service that handles file and worker closures.
[Win32 event contracts](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-createeventw)
[Multiple-object waits](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitformultipleobjects)

The original constructors are `0x704CB0` and `0x5BCA60` in the two
frozen profiles. The tests query the original output pin for its
`IAsyncReader`, read across a 4 MiB MemStream boundary and verify the
short read at the end of the file. A fresh process restores the reader
while its flush event is signaled, ends the flush and releases the
source interfaces, events, locks and worker. The implemented wait domain
is unnamed, default-security event objects with no APC delivery. An
in-flight PE wait requires completion before checkpoint export.

## Renderless Plane source connection

SimplePlane runs the original movie load and destruction code on both
frozen profiles. The loader creates its native MemStream and source
filter, then obtains a FilterGraph and a renderless VMR9 filter from the
DirectShow platform service. It requests one stream and passes the
original allocator to the Notify interface. The graph joins and retains
the actual source filter, and queries its output pin for
`IAsyncReader` when connecting. The original reader's length and prefix
read are checked against its mounted file object. The browser opens media
using those source bytes or a sidecar matched to their size and SHA-256.
An alias or override with the same name and different bytes cannot
select a stale conversion.
[DirectShow graph builder](https://learn.microsoft.com/en-us/windows/win32/api/strmif/nn-strmif-igraphbuilder)

The platform's paused state decodes a preroll frame and copies it into
the negotiated X8R8G8B8 surface through its shared D3D9 lock. The original
`PresentImage` transfers it to the Plane texture. Portable checkpoints
retain the original source and COM identities, decoder metadata,
position and presented texture. The browser opens a fresh decoder on
the first request for a frame after restore. When the movie closes, the
filter also retires the Notify query the loader stores at record offset
`0x144`, which the guest destructor leaves unreleased.
[Wine VMR9 interface ownership](https://github.com/wine-mirror/wine/blob/wine-8.0/dlls/quartz/vmr9.c)

The original main `0x2BD` wrapper formats the filename and sends the
load packet. The matching `0x2BE` sends the movie query and exposes a
borrowed handle to the Plane's `kcVideo`. Repeated queries return the
same handle. The original `kcVideo` destructor invalidates it when the
Plane replaces or releases its model. The movie's ordinary play, stop,
running and position wrappers call the same native object. The Plane
owns destruction.

Browser media supplies frames to the shared D3D device while the native
movie is running. The native GraphManager draws that texture with the
Plane's geometry and visibility. The browser's end event wakes the
original completion worker, which updates the running word and repeat
count. A restored active movie retains its presented texture and
opens its decoder at the saved position on the first active update.
[DirectShow playback states](https://learn.microsoft.com/en-us/windows/win32/api/control/nf-control-imediacontrol-run)
[DirectShow completion](https://learn.microsoft.com/en-us/windows/win32/api/control/nf-control-imediaevent-waitforcompletion)

Chromium tests run both original loaders with a generated AVI and its
WebM sidecar. They check missing and disabled loads, qualified resource
selection, dimensions, asymmetric pixels, power-of-two padding, active
portable restore, the final canvas, explicit stop, natural completion
and resource release. The repeated playback test observes the original
rewind and a second decoder pass after fresh restore. The graph remains
Running after that pass ends, so the original worker's state poll
remains parked until Stop or another state transition.

## Plane Texture Renderer

Main `0x3DC` formats a filename in the `veff` category and sends the
other original Plane movie message. Main `0x3DD` retrieves its
borrowed `kcVideo` handle from the Texture Renderer registry. Its
loader adds the original Texture Renderer filter to the graph and
uses the same original MemStream and source pin as the VMR9 loader.

The browser submits an RGB32 `AM_MEDIA_TYPE` and `VIDEOINFOHEADER`.
The original filter checks that type and creates its own A8R8G8B8
texture. The browser then presents each decoded frame as a bottom-up
RGB32 sample through the two `IMediaSample` methods used by the
original upload routine. The guest controls the row reversal, pitch,
texture padding, dirty state and final Plane draw. The actual filter
is released with the graph and its destructor releases the texture.
[DirectShow media types](https://learn.microsoft.com/en-us/windows/win32/api/strmif/ns-strmif-am_media_type)
[DirectShow media samples](https://learn.microsoft.com/en-us/windows/win32/api/strmif/nn-strmif-imediasample)

The mounted Chromium cases exercise both movie types in each frozen
profile. The Texture Renderer cases verify the distinct resource
category and handle registry, asymmetric RGB32 samples, transparent
texture padding, final canvas pixels, active and repeat-poll restore,
and teardown of the original filter, events and texture.
