# Vue scoped CSS and body-level state selectors

## Conclusion

In Vue 3.5.42, this rule inside `<style scoped>`:

```css
:global(body.queue-drawer-open) .notice--suppress-behind-queue {
  visibility: hidden;
}
```

compiles to:

```css
body.queue-drawer-open {
  visibility: hidden;
}
```

The descendant selector is dropped. Opening the playback queue therefore hid
the entire document, including the drawer.

Use a separate non-scoped `<style>` block for selectors that depend on a state
class on `<body>`. Mixing scoped and non-scoped style blocks in one SFC is an
officially documented Vue feature.

## Sources

- official docs: [Vue SFC CSS Features: Global Selectors and Mixing Local and Global Styles](https://vuejs.org/api/sfc-css-features.html#global-selectors)
- upstream source: [`pluginScoped.ts` at v3.5.42](https://github.com/vuejs/core/blob/v3.5.42/packages/compiler-sfc/src/style/pluginScoped.ts), especially the `:global` / `::v-global` rewrite
- local reproduction: `vue/compiler-sfc@3.5.42` compiling the actual
  `src/components/GlobalNotice.vue` style block

Research date: 2026-11-15.

Versions checked: Vue 3.5.42, `@vitejs/plugin-vue` 6.0.8.

## Impact

This constrains `src/components/GlobalNotice.vue` and future body-level state
selectors. Do not rely on scoped `:global(...)` when a descendant selector must
survive compilation; use a non-scoped style block.

## Unconfirmed

This behavior may change in later Vue compiler releases. The non-scoped block is
still the safer choice for a body-level state selector. Re-evaluate if the
project upgrades Vue and a regression test demonstrates that the scoped form
keeps the full selector.
