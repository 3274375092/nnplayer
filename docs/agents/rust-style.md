# Rust style

Rust code (under `src-tauri/`) follows the [Google Rust Style Guide](https://google.github.io/styleguide/rustguide.html), adapted for this repository. Where this document is silent, follow the official Rust Style Guide and the [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/).

API-design rules below are binding for code consumed outside its module (Tauri commands, `state.rs`, `models.rs`, `error.rs`) and strong recommendations elsewhere.

## Code organization

- Name source files and leaf modules after their primary item (`mod foo` / `foo.rs`).
- No public APIs in non-leaf modules: only module declarations and re-exports. Exceptions: `mod test`, small "ties things together" code.
- No glob imports, except `use super::*` for inline modules and `use SomeEnum::*` inside functions that use that enum.
- One module per `use` statement (rustfmt `imports_granularity = Module`); no `::` inside a `{..}` block.
- Import traits in the narrowest scope that needs them (function body if only used there).
- Call free functions qualified with their module (`mem::transmute(y)`), but use type names unqualified (`Regex`, not `regex::Regex`); qualify only to resolve ambiguity.

## Formatting

- Run `cargo fmt` before committing. `#[rustfmt::skip]` is allowed only for manual alignment or generated code, never personal preference.
- Target rustfmt settings: `max_width = 100`, `hex_literal_case = "Lower"`, `format_macro_matchers = true`, escape invisible characters in literals (`\u{200D}`).

## Ownership and borrowing

- Avoid `Rc` and `Arc` unless the alternative makes ownership unreasonably complex.
- Borrow instead of `.clone()`; clone only when a real deep copy is needed or borrowing is excessively complicated. Cloning `Rc`/`Arc` is fine.

## Function inputs and outputs

- Accept flexible references: `&T` not `&Box<T>`, `&[T]` not `&Vec<T>`, `&str` not `&String`, `Option<&T>` not `&Option<T>`.
- Return iterators instead of `Vec<T>` from reusable code when callers only iterate; `Vec` is fine in application code when simpler or when callers need owned/indexed data.
- `impl Into<T>` parameters only where call-site ergonomics genuinely matter; avoid them in application code.
- Prefer an enum over a bare `bool` when the parameter's purpose is not obvious at the call site.
- Error reporting: `Option` for simple obvious absence, `Result` for recoverable failures with context, `panic!` only for bugs and violated invariants (tests and dev binaries may panic).

## Types

- Use newtypes instead of type aliases when types carry distinct semantics, need their own API, or the underlying representation may change.
- Prefer named fields over tuple structs (exception: single-field newtypes and very local contexts).

## Traits

- Implement standard-library traits instead of custom methods (`impl FromStr`, not `fn from_str`) — Clippy `should_implement_trait`.
- Use `#[derive(...)]` whenever it suffices.
- Prefer generics over `dyn Trait` in reusable code parameters (exception: code size matters more).
- Define traits only for generic programming or extension purposes; don't use traits merely to organize code.
- Extension traits get an `Ext` suffix (e.g. `TrackExt`).
- Error types should be `Copy` where possible; implement `Default` alongside `new()`; implement `Hash`+`Eq` for likely map keys; pair important `From` impls with an explicit `::new()` or `::from_foo()`.
- Options structs implement `Default` (enables struct update syntax).

## Concurrency

- Never extract data from a poisoned mutex; propagate the poisoning.
- In this repo async/`.await` is normal (Tauri commands); prefer `tokio` synchronization primitives and avoid blocking calls inside async contexts.

## Macros

Preference order: plain functions/types/traits → `macro_rules!` → proc macros. Avoid macros where a function works.

## Naming

- Follow std conventions for `as_`/`to_`/`into_` with the correct self type (Clippy `wrong_self_convention`).
- Constructors: `new()`, `new_with_foo()`, `try_new()` when returning `Result`; conversions use `from_foo()` with a `From` impl.
- Accessors: `foo()` (getter, `&T` or `T: Copy`), `foo_mut()`, `take_foo()`, `set_foo()`, `with_foo()`/`with_mut_foo()` (closure-based; preferred for interior-mutability wrappers so `MutexGuard` doesn't leak into signatures), `replace_foo()`.
- Lifetimes: descriptive names; at most two single-letter lifetimes for simple input/output relations, then switch to descriptive. Generic parameters: short, indicative, ideally from the main trait bound.
- No obscure abbreviations or acronyms.

## Documentation

- Doc-comment public APIs with `///` (`//!` for module/crate docs at file top), in Markdown, with correct capitalization and punctuation.
- Document panic cases, and unsafe invariants when applicable.
- Don't restate names or explain language basics. `//` for implementation notes.

## Unsafe and other features

- No `unsafe` unless there is no safe alternative; encapsulate it behind a safe abstraction and add a `SAFETY:` comment with technical justification.
- No unstable features.
- Mark public functions `const` only if they will stay `const`.
- Operator overloading only for mathematical/logical semantics, not syntax sugar.
- `#[non_exhaustive]` on public enums/structs whose set of variants/fields is expected to grow; not for fixed ontologies.
- `#[must_use]` on pure functions where ignoring the result is pointless, and on error types.
- No pre-main code execution (e.g. the `ctor` crate).

## Implementation guidance

- Don't overuse type inference: give explicit types for `.into()`, `.parse()`, and long iterator chains; prefer typed declarations over turbofish.
- Prefer pattern matching (`if let Some(v)`) over check-then-unwrap (`is_some()` + `unwrap()`).
- Prefer `expect` with a reason over `unwrap`.
- Add context strings to `assert!` when the reason isn't obvious; don't merely restate the condition.
- Avoid long combinator chains when a `for` loop is clearer; don't chain combinators in a for-loop header; avoid `Iterator::for_each`.
- Don't use `panic::catch_unwind` in first-party code.
- Prefer `format!`/`write!` over repeated `+` concatenation.

## Tests

- Use `#[test]` (and `#[tokio::test]` for async) in a `mod test` within the module under test, or under `src-tauri/tests/` for integration tests.
