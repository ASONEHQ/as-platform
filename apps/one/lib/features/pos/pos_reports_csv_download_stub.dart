/// TASK 14.4 (Wave 2, Part D): the VM-safe fallback for [downloadCsvFile]
/// — mirrors `receipt_print_stub.dart` exactly. Always returns `false`
/// ("could not trigger a browser download"), never silently pretends to
/// have saved a file.
library;

bool downloadCsvFile({required String filename, required String csvContent}) => false;
