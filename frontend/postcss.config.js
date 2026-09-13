/**
 * Vendor prefixing.
 *
 * Tailwind's PostCSS plugin used to do this, and when Tailwind was removed the
 * config went with it — leaving eight `backdrop-filter` and nine `user-select`
 * declarations with no `-webkit-` twin. Both matter most on iOS Safari and the
 * Android webview, and `user-select` is what keeps a long-press on the header
 * from selecting the label instead of pressing the control.
 *
 * Autoprefixer reads the browserslist field in package.json, so the targets
 * live there rather than here.
 */
export default {
  plugins: {
    autoprefixer: {},
  },
}
