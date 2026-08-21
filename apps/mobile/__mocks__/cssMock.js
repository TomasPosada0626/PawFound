// NativeWind's CSS side-effect import (global.css) isn't something Jest can parse —
// Metro handles it via `withNativeWind`. Stub it out for tests.
module.exports = {};
