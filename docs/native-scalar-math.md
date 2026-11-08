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
