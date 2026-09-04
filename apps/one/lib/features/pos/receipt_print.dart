/// TASK 12.5B: browser print foundation — see ADR-0012. Exports the real
/// `package:web`-backed implementation when compiling for web/wasm
/// (`dart.library.js_interop`), and a VM-safe no-op everywhere else —
/// `flutter test` runs on the Dart VM, which has neither `dart:html` nor
/// `package:web`'s browser bindings at all, so an unconditional import of
/// either would break every widget test in this app.
///
/// The single exported symbol, [openReceiptPrintWindow], is the only way
/// any caller in this app ever touches a browser print API — see its own
/// doc comment (in `receipt_print_web.dart`) for the full contract.
library;

export 'receipt_print_stub.dart' if (dart.library.js_interop) 'receipt_print_web.dart';
