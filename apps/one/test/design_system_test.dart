import 'package:as_one/design_system/components/as_components.dart';
import 'package:as_one/design_system/theme/as_theme.dart';
import 'package:as_one/design_system/tokens/as_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('uses a four-point spacing scale and approved primary hierarchy', () {
    expect(AsSpacing.x4, AsSpacing.x1 * 4);
    expect(AsSpacing.x16, AsSpacing.x1 * 16);
    expect(AsColors.primaryDark, isNot(AsColors.primary));
    expect(AsTheme.light().scaffoldBackgroundColor, AsColors.background);
  });

  testWidgets('components expose button and status semantics', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(
      MaterialApp(
        theme: AsTheme.light(),
        home: const Scaffold(
          body: Column(
            children: [
              AsPrimaryButton(label: 'Continuar', onPressed: null),
              AsStatusBadge(label: 'Disponible'),
            ],
          ),
        ),
      ),
    );
    expect(find.bySemanticsLabel('Continuar'), findsWidgets);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Semantics &&
            widget.properties.label == 'Estado: Disponible',
      ),
      findsOneWidget,
    );
    handle.dispose();
  });
}
