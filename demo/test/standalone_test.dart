import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('工程可直接复制运行，依赖不引用工程外的本地目录', () {
    final manifest = File('pubspec.yaml').readAsStringSync();
    expect(
      RegExp(r'^\s+path\s*:', multiLine: true).hasMatch(manifest),
      isFalse,
      reason: '独立商城只使用 Flutter SDK 与公开包，复制目录后不需要兄弟工程。',
    );
  });
}
