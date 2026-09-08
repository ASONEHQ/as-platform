/// TASK 14.4 (Wave 2, Part D): the real, web-only implementation behind
/// `pos_reports_csv_download.dart`'s conditional export — only ever
/// compiled in when building for web/wasm (`dart.library.js_interop`).
/// Uses `package:web` (the official `dart:js_interop`-based replacement
/// for the deprecated `dart:html`), exactly the same package
/// `receipt_print_web.dart` already uses for the browser print window —
/// this app has no other file-saving mechanism (no `file_picker`/`path_
/// provider`/download-manager dependency exists in `pubspec.yaml`), so a
/// `Blob` + temporary `<a download>` anchor click is the simplest
/// approach that is actually real: the browser's own native "Save As"/
/// downloads flow, no server round trip beyond the CSV fetch itself, and
/// no fabricated "export successful" toast without a real file behind it.
library;

import 'dart:js_interop';

import 'package:web/web.dart' as web;

/// Triggers a real browser download of [csvContent] as [filename] via a
/// short-lived `blob:` object URL — never a fake success. Always returns
/// `true`: unlike a popup window, a same-tab anchor-click download is not
/// blocked by popup blockers, so there is no realistic browser-side
/// failure mode to report false for here (mirrors
/// `openReceiptPrintWindow`'s own honest-boolean contract, just without a
/// blockable case).
bool downloadCsvFile({required String filename, required String csvContent}) {
  final blob = web.Blob(
    [csvContent.toJS].toJS,
    web.BlobPropertyBag(type: 'text/csv;charset=utf-8;'),
  );
  final url = web.URL.createObjectURL(blob);
  final anchor = web.document.createElement('a') as web.HTMLAnchorElement
    ..href = url
    ..download = filename
    ..style.display = 'none';
  web.document.body?.append(anchor);
  anchor.click();
  anchor.remove();
  web.URL.revokeObjectURL(url);
  return true;
}
