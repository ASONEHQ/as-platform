/// TASK 12.5B: the VM-safe fallback for [openReceiptPrintWindow] — this
/// app only ever ships as Flutter Web (`flutter build web`), but
/// `flutter test` runs on the Dart VM, where no browser window/print API
/// exists at all. Every real caller goes through `receipt_print.dart`'s
/// conditional export, which only ever picks this file when
/// `dart.library.js_interop` is unavailable (i.e. not compiling to
/// web/wasm) — so this always returns `false` ("could not open a print
/// window"), never silently pretends to have printed anything.
library;

bool openReceiptPrintWindow(String html) => false;
