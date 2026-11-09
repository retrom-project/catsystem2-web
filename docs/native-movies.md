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

`prepare:media` converts WMV, AVI, MPEG and OGV resources outside the original game tree.
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

The original output pin's media-type enumerator allocates its 72-byte
descriptor through the Win32 COM task allocator. The shared kernel
tracks those allocations in the PE heap and carries their ownership
through checkpoint restore. The caller releases the descriptor with
`CoTaskMemFree`. Tests execute the original enumerator on both profiles
and release the same saved descriptor in two independent processes.
[COM task memory](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-cotaskmemalloc)

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
Texture sampling follows the detached media element's 100-nanosecond
playback position. A sparse H.264 stream can advance after seeking
while the browser's compositor frame count remains fixed.
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

## Original WebM filters

The frozen WebM constructors at `0x705E80` and `0x5BDCC0` acquire
`webmsplit.dll`, `vpxdecoder.dll` and `webmvorbisdecoder.dll` through
the original DLL and class factory sequence. The Web platform supplies
those COM factories. The connection entries at `0x706130` and
`0x5BDF70` insert the filters and ask the shared device whether it
supports YV12 to X8R8G8B8 conversion. With the current device they add
the AVI Decompressor and Color Space Converter. Browser decoding
supplies the RGB samples for the original renderer.
[WebM DirectShow filters](https://www.webmproject.org/tools/)

The original source pin connects to the splitter input through
`ConnectDirect` and `IPin::Connect`. The splitter reads the mounted
source, validates its EBML headers and exposes the declared VP8 or VP9
track and optional Vorbis track. The original EXE enumerates and renders
those pins. Other audio codecs have no output pin. With no Vorbis pin,
the browser leaves the movie silent even when its decoder can play the
encoded audio. A source that would require choosing between multiple
video tracks or ambiguous audio tracks fails the connection.
[WebM container format](https://www.webmproject.org/docs/container/)

The reference comparison uses the published WebMDShow 1.0.4.1 ZIP
with SHA-256
`7e560facc0833cd48afaf8b7f8a1dcd92846552cae0fc81f4fadb5eee971a728`.
The x86 DLLs are reference inputs in the pinned Wine probe.
[WebMDShow 1.0.4.1 release](https://storage.googleapis.com/downloads.webmproject.org/releases/webm/index.html)

| Module                  | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `webmsplit.dll`         | `6ea17cf203433c1e21ca0a1288b05becc72f709e6260e51fafddfb639e82f3e2` |
| `vpxdecoder.dll`        | `d4bd32fbeda234e01d2b3b30e3accfdf200c5f382c248c15a999d2d6a6796337` |
| `webmvorbisdecoder.dll` | `6338ea9979b74daf3424904affd277a335928947ebba037805d4a517f8aa9b3d` |

The probe acquires all three factories using the original class IDs.
It observes an empty preferred-type enumeration on the splitter input,
a connected source pin, VP8 and Vorbis outputs for one sample, and
a sole VP9 output for the VP9/Opus sample. The actual VPx and Vorbis
decoders accept the corresponding output pins. Chromium exercises
the mounted VP8/Vorbis file on both original renderers and profiles,
including a 440 Hz PCM sample. The VP9/Opus file exercises the original
VMR9 path on both profiles and remains silent. The cases check failed
connection, native pin and module identities, presented pixels, repeat
and stop, and a new instance restored during playback.

## Original Ogg Theora filters

Both frozen Plane loaders take the original OGV branch. The constructors
at `0x7065E0` and `0x5BE420` acquire the Xiph splitter, Theora decoder
and Vorbis decoder class factories. The connection entries at
`0x706860` and `0x5BE6A0` add the three original named filters and
connect the original CAsyncReader output. WebM and Ogg use the same
DirectShow graph and COM identity service.
[Xiph DirectShow filters](https://www.xiph.org/dshow/downloads/)

The Ogg input advertises its original Stream and Ogg subtype. Each
logical stream carries its initial identification packet as the
format block of the original Ogg packet media type. Pin discovery
reads the mounted source's Ogg pages and validates the lacing and
page checksums. Skeleton metadata produces no pin. The supported
rendering path is one Theora track and optional Vorbis audio. An
additional unsupported logical stream still produces a pin and
causes the graph to reject the connection with the supplied decoders.
[Ogg framing](https://xiph.org/ogg/doc/framing.html)

Chromium 149 requires a prepared sidecar for Theora. The existing
`prepare:media` tool uses FFmpeg to decode the OGV and prepare H.264 and AAC, tied to
the mounted file's size and SHA-256. A browser that supports the
declared Theora MIME can use the mounted stream directly. Both
paths keep the original Plane renderer and playback controls.
[Chromium Theora removal](https://chromestatus.com/feature/5158654475239424)

The pinned Wine comparison uses Xiph OpenCodecs 0.85.17777, installer
SHA-256
`fcec3cea637e806501aff447d902de3b5bfef226b629e43ab67e46dbb23f13e7`.
The x86 files are comparison inputs for the original classes.
[Xiph OpenCodecs releases](https://www.xiph.org/dshow/downloads/)

| Module                 | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `dsfOggDemux2.dll`     | `f5368e01e9bc0e58b41e8cc1d20746efc4b7b802771956d3bbb3b994beebaa52` |
| `dsfTheoraDecoder.dll` | `c593cff519126f30fb4a09c8f6df3f8d593d558a3b711c0e23549a5972095e19` |
| `dsfVorbisDecoder.dll` | `528c0656751b336c10cb4c49b703eae9c3863f7f416d0e09b198b082cc54aeb8` |

The real filters connect the authored Theora and Vorbis streams.
The comparison also observes an Opus output pin whose connection
to the registered Vorbis decoder fails. Chromium exercises the
Theora and Vorbis fixture with the original VMR9 and Texture Renderer
on both profiles. It checks defined media type words, sample pixels
and a 440 Hz signal, fresh decoder and COM identity restoration,
the original stop and repeat worker, and resource release.

## WMV files in the Plane loader

The 2.6.1.76 loader creates its embedded WMV filter at `0x709B80`
and its IStream adapter at `0x7094D0`. The adapter reads the same mounted
file as the original CAsyncReader. The filter opens that stream through
`WMCreateReader` and `IWMReaderAdvanced2::OpenStream` at `0x70B3C0`,
requests compressed streams, creates the original video and audio pins,
and adds the filter to DirectShow under its original name. The application
keeps the original Pause, Run, Stop, user-clock, and EOF callbacks.
SDK 4.01 takes the unknown-format branch at `0x5BB7A3`, closes its
partially initialized movie and returns zero for `.wmv`.
[Windows Media reader](https://learn.microsoft.com/en-us/windows/win32/wmformat/reader-object)
[Compressed stream callbacks](https://learn.microsoft.com/en-us/windows/win32/wmformat/copying-streams-without-decompressing-the-data)

The browser replaces sample delivery and decoding downstream of those pins.
It uses the provenance-matched H.264/AAC conversion from
`prepare:media` for decoded pixels and PCM. The ASF header supplies stream
identities in header order, compressed media types and play duration
after subtracting preroll. For audio and video profiles, the compressed
video rate follows the packet and frame budgets in `wmasf.dll` at
`0x11C7F29E`. It accounts for the final audio track and each video
track in stream order. A stream bitrate table supplies separate budgets
and the extended stream properties can override the computed rate.
The original reader and both browser Plane output pins report
386,155 bit/s for the authored sample. The Plane clock uses sample
positions and duration. The original loader dispatches by `.wmv`, and
the mounted files carry ASF data.
[ASF header fields](https://learn.microsoft.com/en-us/windows/win32/medfound/media-foundation-attributes-for-asf-header-objects)

The pinned Wine comparison opens the authored WMV2/WMA2 file through the
actual Microsoft x86 reader, enumerates both compressed media types,
observes the open and close callbacks, and obtains RGB and PCM from the
actual Windows Media decoders. The DLLs are version `11.0.5721.5262`
from `wmfdist11.exe` in the Windows Media Player 11 package. The outer
package SHA-256 is
`ffd321a441a67001a893f3bde4bb1afba07d4d2c9659bfdb0fbb057e7945d970`.
[Microsoft redistributable archive](https://web.archive.org/web/20170628063001id_/http://download.microsoft.com/download/0/9/5/0953e553-3bb6-44b1-8973-106f1b7e5049/wmp11-windowsxp-x86-enu.exe)

| Module         | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------ |
| `wmvcore.dll`  | `3254ec601f394d9a4b03eeb0da7e99df662647c33f81ce7e60ed2b57945bdc59` |
| `wmasf.dll`    | `120b73327071a0d713c561759caa126a0fbc1a6f75ccdacfad73fd0da25d3066` |
| `wmvdecod.dll` | `b873931c37019fd6cc93cf5655a4ea6a7d82ac62a9a567cbbe112f9c3162d5b5` |
| `wmadmod.dll`  | `eddf74030dba828a3a5e96cfe282dc11f04fd84e26420ffa6c68041d199fc66b` |

Chromium tests exercise both original renderers with the WMV fixture,
including malformed input, the original output pins and media types,
several canvas colors, a 440 Hz signal, completion, replay, an independent
fresh World and release of the native filter and IStream. SDK tests
verify the original rejection through both Plane commands.

The ASF packet reader indexes compressed media objects with their
presentation time, clean-point flag and byte ranges in the mounted
file. It joins objects spanning several packets and expands packed
sub-payloads. The test fixtures reproduce all 166 compressed samples
from the original synchronous reader, including six fragmented objects.
The original Plane connection checks the first complete video sample
from its IAsyncReader before opening the browser decoder. Later sample
delivery, seeking and decompression continue through the browser media
adapter. The packet reader covers uncorrected finite ASF packets.
[ASF specification](https://download.microsoft.com/download/7/9/0/790fecaa-f64a-4a5e-a430-0bccdab3f1b4/ASF_Specification.doc)
[Windows Media synchronous reader](https://learn.microsoft.com/en-us/windows/win32/wmformat/to-retrieve-media-samples-with-the-synchronous-reader)

## Legacy Hap5 frame decoding

The two original Hap constructors at `0x6FC750` and `0x5BAC80`
register the `vidc.Hap5` driver under `dsfilter/HAPCODEC.dll`. The
Game constructor supplies the path in UTF-16. SDK 4.01 converts it
to ANSI before calling `ICInstall`. The pinned Wine test observes a
successful registry write for both encodings, followed by a successful
`ICOpen` only for ANSI. The original connect method enumerates the
CAsyncReader output and asks DirectShow to render it.
[ICInstall](https://learn.microsoft.com/en-us/windows/win32/api/vfw/nf-vfw-icinstall)

The frame decoder reads Hap5 video packets from AVI and AVI continuation
segments. The pinned HapCodec uses the four-byte Hap header with a
24-bit payload size and accepts raw BC3 and single-block Snappy payloads.
The original driver returns the BC3 block array or, when
requested, positive-height bottom-up BGRA32. The Web decoder exposes the
same RGB and alpha samples in top-down RGBA order. The tests compare all
3,072 output bytes for each compression mode and a frame with varied
BC3 endpoints and selectors. Longer section headers and chunked Snappy
belong to newer Hap variants. The pinned driver returned success while
the destination stayed zero for the tested extended-header Snappy packets.
[Original Hap decoder source](https://github.com/Vidvox/hap-directshow/blob/23064e2f8459917de58c2b49aa511492e599ce9a/Source/External/hap/hap.cpp)

The comparison uses RenderHeads Hap DirectShow v1.0.10, installer SHA-256
`dc5fe2386988847f4c9f32c2bdc4a7becf5857cf84a730b4131397a3736ee908`.
The extracted x86 `HapCodec.dll` SHA-256 is
`be668219992b7028dc3411af834b44af3439c82b2ec4a25c9616f64084bf9b18`.
[Vidvox release](https://github.com/Vidvox/hap-directshow/releases/tag/v1.0.10)

The original SDK Plane loaders use the registered Hap5 driver to render
the CAsyncReader output. The browser VfW provider keeps the driver's
registration scoped to the World and decodes frames from the mounted AVI.
The Texture Renderer negotiates ARGB32 and copies
the decoder's alpha bytes into the original texture. The VMR9 path
uses the opaque X8R8G8B8 decoder surface. The Game loaders take their
failed graph path after registering the truncated driver name.

An AVI can carry one integer PCM track. The provider reads its original
wave format and audio packets and schedules the sample buffer on the
World's AudioContext. The VfW comparison reads 48,000 mono 16 kHz samples
from the fixture using `AVIStreamRead`. All 96,000 PCM bytes match.
The provider reports an unsupported format for compressed AVI audio.
[AVIStreamRead](https://learn.microsoft.com/en-us/windows/win32/api/vfw/nf-vfw-avistreamread)
[WAVEFORMATEX](https://learn.microsoft.com/en-us/windows/win32/api/mmreg/ns-mmreg-waveformatex)

Silent playback uses the shared World clock. With PCM, the AudioContext
clock drives both streams and AVI rate and scale select the video frame.
Portable restore retains the position, presented texture, completion
worker, driver registration and volume. It recreates the audio source
at the saved offset when playback activates. Chromium checks both SDK
renderers through the original KCS load, query, play, stop and repeat
calls. It measures the 440 Hz signal before and after restore and
verifies that the timeline stays fixed when the audio device is
suspended. The frame tests cover straight alpha on the Texture Renderer,
compositing on the actual canvas and the Game registration failure for
both loaders.
[Web Audio API](https://www.w3.org/TR/2021/REC-webaudio-20210617/)
