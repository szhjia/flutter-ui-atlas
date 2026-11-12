import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'The project can be copied without local dependencies outside its directory',
    () {
      final manifest = File('pubspec.yaml').readAsStringSync();
      expect(
        RegExp(r'^\s+path\s*:', multiLine: true).hasMatch(manifest),
        isFalse,
        reason:
            'The standalone shop uses only Flutter and public packages, with no sibling projects.',
      );
    },
  );
}
