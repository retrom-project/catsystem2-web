# Native scalar math

The eighteen main scalar interfaces `32..40`, `18D`, `1CD` and `36A` execute
their complete original wrappers in the mounted engine. This includes the
trigonometric functions, rounding, remainder, square root, power, angle-unit
conversion, integer absolute value, `atan2`, decimal logarithm and low/high-word
packing. `18D` takes y followed by x, as confirmed by literal reference calls.

Math shares the engine's actual x87/SIMD thread with native plugins. The host
does not convert a returned NaN, signed zero or denormal through a JavaScript
number. Original precision, rounding and exception status changes are retained.
Adjacent native argument words are read from the caller's mapped frame.

`scripts/verify-native-scalar-math.mjs` executes 3,474 complete calls and 14,262
comparisons per frozen engine. It compares original output canaries and the
entire x87/SIMD context under eight masked precision/rounding configurations.
Inputs include domain errors, signed zero, denormals, infinities, quiet and
signaling NaN payloads, integer limits and adjacent argument reads. Literal
integer packing and signed absolute results are checked separately.

The public SDK World test changes the actual native rounding context. Its
upward-rounded square root of two is one ULP above the ordinary host result.
The same context and result survive a fresh World; changing the restored
context leaves the original World independent.

The paired `36B` unpacking wrapper also runs its complete original code. It
sign-extends each 16-bit half to a DWORD and writes low followed by high through
the original VM translator, returning control 2 without writing a result. Zero
is a valid VM address; identical and overlapping destinations retain that write
order. Live World memory, shared memory and extended blocks use the existing
task-memory binding, including after fresh restore.

`scripts/verify-native-word-unpack.mjs` compares 1,105 complete calls and 7,732
checks per engine. The reference executes the full wrapper without replacing
its VM translator. It checks every byte of data, stack, shared memory and two
extended blocks, including unaligned and overlapping outputs, adjacent argument
reads, FP context and temporary bridge ownership. The SDK World test exercises
the live native backing and an independent restored World.
