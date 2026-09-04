/// TASK 12.5B: the real, web-only implementation behind
/// `receipt_print.dart`'s conditional export — only ever compiled in when
/// building for web/wasm (`dart.library.js_interop`). Uses `package:web`
/// (the official `dart:js_interop`-based replacement for the deprecated
/// `dart:html`) — no proprietary printer SDK.
library;

import 'dart:js_interop';

import 'package:web/web.dart' as web;

/// Opens a brand-new, blank browser tab/window containing only [html] —
/// a self-contained receipt document, never the running POS app's own
/// DOM — and calls that new window's own `print()`. Mirrors AS POS V1's
/// own `imprimirTicketActual()` mechanism exactly (`window.open('',
/// '_blank', ...)`, `w.document.write(...)`, `w.print()`): the browser's
/// native print dialog, no proprietary printer SDK, and the POS
/// sidebar/navigation/buttons are structurally absent from [html] rather
/// than merely hidden by CSS, so nothing Flutter itself renders can ever
/// leak into the printed page.
///
/// Returns `false` (never throws) when the browser blocked the popup —
/// the caller must report that honestly rather than pretend a print
/// window opened; this never silently selects or drives a printer
/// without that visible, user-facing browser dialog.
bool openReceiptPrintWindow(String html) {
  final popup = web.window.open('', '_blank');
  if (popup == null) return false;
  final doc = popup.document;
  doc.open();
  doc.write(html.toJS);
  doc.close();
  popup.print();
  return true;
}
