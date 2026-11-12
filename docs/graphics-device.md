# Shared graphics device

`NativeGraphics.device` and `StageRenderer.graphicsDevice` refer to one live
`NativeGraphicsDevice`. Construction is `detached`; absence of a canvas does not
mean device loss or successful creation. A headless host can explicitly call
`graphics.createLogicalDevice()`. Stage attachment adopts the same owner and
validates its actual WebGL resources before `ready`.

Loss follows `ready → lost → not-reset → rebuilding → ready`. A generation is
allocated only when attachment or reconstruction validates successfully. The
restored event publishes `not-reset`; it does not establish readiness. Failed
reconstruction stays `not-reset`. A late async operation cannot publish a ready
generation after loss, retirement or close. Attachment handles, reconstruction
Promises, device status and physical generations are live host state, not saved
claims that an unrelated fresh GPU is ready.

WebGL recovery rebuilds programs, buffers, textures, framebuffer and depth handles
before publishing ready. The GPU, existing target/depth objects, NativeD3D target
references and logical render-state maps retain their identity. Cached managed
textures reupload their actual CPU source. Restoration does not perform frame
readback or upload stale CPU copies of render targets.

Device readiness and volatile content validity are separate. Render target/depth
storage is recreated with undefined content. Sampling, presentation, readback and
checkpoint reads reject undefined content. Each existing target/depth resource
has explicit validity metadata; missing metadata does not mean defined. An absent
depth attachment or zero actual read has no content to validate. Format 75 has
depth and stencil; formats 77/80 have depth only, so requested stencil tests do
not consume validity bits for a nonexistent stencil attachment. Full Clear, full upload, explicit
depth restore or a known complete blend producer can define the relevant storage.
Partial clears, partial uploads and ordinary geometry do not declare the entire
storage defined. No coverage-region model is inferred. Normal complete frame
production can run on a ready device and define its output; undefined contents
are not a global device-loss condition.

D3D9 distinguishes `D3DERR_DEVICELOST` (`0x88760868`) from
`D3DERR_DEVICENOTRESET` (`0x88760869`). The original effect task tests those actual
values; its pending reset callbacks and child-draw order remain separate work.
Graph message 49 is a graph position setter and supplies no device readiness.

D3D9's [resource management](https://learn.microsoft.com/en-us/windows/win32/direct3d9/managing-resources)
and [Reset contract](https://learn.microsoft.com/en-us/windows/win32/api/d3d9/nf-d3d9-idirect3ddevice9-reset)
require default-pool resources to be recreated while managed textures have system
memory. Rebuilding WebGL shader/program handles is the browser context-recovery
implementation; it does not assert that D3D9 shaders themselves are destroyed by
Reset. This leaf does not enable kind 61, implement its reset callbacks, or change
World frame execution/CRT/RNG ordering.
