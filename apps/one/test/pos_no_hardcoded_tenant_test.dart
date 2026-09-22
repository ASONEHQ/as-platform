// TASK 16.17 — ACCESS GO is multi-tenant: no customer's own name (company,
// branch, operational area) may be hardcoded into the app's CODE or user-
// facing COPY. INFLAPARK is customer #1, not shared application logic.
//
// A source scan of every `lib/` Dart file with NO allow-list. Comments are
// ignored on purpose (they legitimately explain "tenant-defined, e.g. …"
// without ever reaching a screen or a printout); every string literal and
// identifier is checked.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

const _forbidden = ['inflapark', 'puerta la victoria', 'taquilla'];

String _withoutComments(String source) {
  final buffer = StringBuffer();
  for (final line in source.split('\n')) {
    final trimmed = line.trimLeft();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    buffer.writeln(line.replaceFirst(RegExp(r'(^|\s)//.*$'), ''));
  }
  return buffer.toString();
}

void main() {
  final libFiles = Directory('lib')
      .listSync(recursive: true)
      .whereType<File>()
      .where((file) => file.path.endsWith('.dart'))
      .toList(growable: false);

  test('the scan is not vacuous (it sees the readiness surface and the shell)', () {
    final paths = libFiles.map((file) => file.path.replaceAll('\\', '/')).toList();
    expect(libFiles.length, greaterThan(50));
    expect(paths.any((path) => path.endsWith('features/pos/pos_readiness_screen.dart')), isTrue);
    expect(paths.any((path) => path.endsWith('features/pos/pos_shell.dart')), isTrue);
  });

  test('no lib/ code or user-facing string hardcodes a customer, branch or area name', () {
    final offenders = <String>[];
    for (final file in libFiles) {
      final text = _withoutComments(file.readAsStringSync()).toLowerCase();
      for (final word in _forbidden) {
        if (text.contains(word)) offenders.add('${file.path} contains "$word"');
      }
    }
    expect(offenders, isEmpty);
  });
}
