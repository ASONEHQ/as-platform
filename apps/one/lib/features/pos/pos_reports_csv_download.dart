/// TASK 14.4 (Wave 2, Part D): browser CSV download foundation — mirrors
/// `receipt_print.dart`'s own established conditional-export shape exactly
/// (see that file's doc comment): the real `package:web`-backed
/// implementation when compiling for web/wasm (`dart.library.js_interop`),
/// and a VM-safe no-op everywhere else, because `flutter test` runs on the
/// Dart VM, which has neither `dart:html` nor `package:web`'s browser
/// bindings at all.
///
/// The single exported symbol, [downloadCsvFile], is the only way any
/// caller in this app ever triggers a browser CSV download — see its own
/// doc comment (in `pos_reports_csv_download_web.dart`) for the full
/// contract.
library;

export 'pos_reports_csv_download_stub.dart'
    if (dart.library.js_interop) 'pos_reports_csv_download_web.dart';
