// Disposable. Run from meta-frames-app:
//   FLUTTER_ROOT=<sdk> BASELINE_OUT=<dir> flutter test --packages=.dart_tool/package_config.json --update-goldens <this file>
// Writes app-resolved.json to BASELINE_OUT and goldens beside this file.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meta_frames/ui/core/theme.dart';

final _appDir = Directory.current.path;

Future<void> _loadFont(String family, String asset) async {
  final bytes = File('$_appDir/$asset').readAsBytesSync();
  final loader = FontLoader(family)
    ..addFont(Future.value(ByteData.view(bytes.buffer)));
  await loader.load();
}

Map<String, int> _scheme(ColorScheme cs) => {
  'primary': cs.primary.toARGB32(),
  'onPrimary': cs.onPrimary.toARGB32(),
  'primaryContainer': cs.primaryContainer.toARGB32(),
  'onPrimaryContainer': cs.onPrimaryContainer.toARGB32(),
  'secondary': cs.secondary.toARGB32(),
  'onSecondary': cs.onSecondary.toARGB32(),
  'secondaryContainer': cs.secondaryContainer.toARGB32(),
  'onSecondaryContainer': cs.onSecondaryContainer.toARGB32(),
  'tertiary': cs.tertiary.toARGB32(),
  'onTertiary': cs.onTertiary.toARGB32(),
  'tertiaryContainer': cs.tertiaryContainer.toARGB32(),
  'onTertiaryContainer': cs.onTertiaryContainer.toARGB32(),
  'error': cs.error.toARGB32(),
  'onError': cs.onError.toARGB32(),
  'errorContainer': cs.errorContainer.toARGB32(),
  'onErrorContainer': cs.onErrorContainer.toARGB32(),
  'surface': cs.surface.toARGB32(),
  'onSurface': cs.onSurface.toARGB32(),
  'onSurfaceVariant': cs.onSurfaceVariant.toARGB32(),
  'outline': cs.outline.toARGB32(),
  'outlineVariant': cs.outlineVariant.toARGB32(),
  'surfaceContainerLowest': cs.surfaceContainerLowest.toARGB32(),
  'surfaceContainerLow': cs.surfaceContainerLow.toARGB32(),
  'surfaceContainer': cs.surfaceContainer.toARGB32(),
  'surfaceContainerHigh': cs.surfaceContainerHigh.toARGB32(),
  'surfaceContainerHighest': cs.surfaceContainerHighest.toARGB32(),
  'inverseSurface': cs.inverseSurface.toARGB32(),
  'onInverseSurface': cs.onInverseSurface.toARGB32(),
  'inversePrimary': cs.inversePrimary.toARGB32(),
  'shadow': cs.shadow.toARGB32(),
  'scrim': cs.scrim.toARGB32(),
};

Map<String, Object?> _color(Color? color) => {
  'argb': color?.toARGB32(),
  'alphaExact': color?.a,
};

Map<String, Object?> _values(ThemeData theme) {
  final nav = theme.navigationBarTheme;
  final text = theme.textButtonTheme.style!;
  const selected = <WidgetState>{WidgetState.selected};
  const none = <WidgetState>{};
  const disabled = <WidgetState>{WidgetState.disabled};
  return {
    'brightness': theme.brightness.name,
    'colorScheme': _scheme(theme.colorScheme),
    'nav': {
      'backgroundColor': _color(nav.backgroundColor),
      'indicatorColor': _color(nav.indicatorColor),
      'labelSelected': _color(nav.labelTextStyle!.resolve(selected)!.color),
      'labelUnselected': _color(nav.labelTextStyle!.resolve(none)!.color),
      'iconSelected': _color(nav.iconTheme!.resolve(selected)!.color),
      'iconUnselected': _color(nav.iconTheme!.resolve(none)!.color),
    },
    'disabled': {
      'textButtonForeground': _color(text.foregroundColor!.resolve(disabled)),
      'textButtonIcon': _color(text.iconColor!.resolve(disabled)),
    },
  };
}

Future<void> _pumpGolden(
  WidgetTester tester,
  ThemeData theme,
  Widget home,
  String name,
) async {
  tester.view.physicalSize = const Size(400, 400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: theme,
      home: home,
    ),
  );
  await tester.pumpAndSettle();
  await expectLater(
    find.byType(MaterialApp),
    matchesGoldenFile('../app/$name.png'),
  );
}

void main() {
  setUpAll(() async {
    final flutterRoot = Platform.environment['FLUTTER_ROOT']!;
    final icons = File(
      '$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    ).readAsBytesSync();
    await (FontLoader('MaterialIcons')
          ..addFont(Future.value(ByteData.view(icons.buffer))))
        .load();
    await _loadFont('SpaceGrotesk', 'assets/fonts/SpaceGrotesk.ttf');
    await _loadFont('GeistMono', 'assets/fonts/GeistMono.ttf');
    await _loadFont('JetBrainsMono', 'assets/fonts/JetBrainsMono.ttf');
  });

  test('write resolved values', () {
    final out = Platform.environment['BASELINE_OUT']!;
    final data = {
      'light': _values(buildTheme(Brightness.light)),
      'dark': _values(buildTheme(Brightness.dark)),
    };
    File('$out/app-resolved.json').writeAsStringSync(
      '${const JsonEncoder.withIndent('  ').convert(data)}\n',
    );
  });

  for (final brightness in Brightness.values) {
    final mode = brightness.name;
    final theme = buildTheme(brightness);

    testWidgets('scaffold $mode', (tester) async {
      await _pumpGolden(
        tester,
        theme,
        Scaffold(
          appBar: AppBar(title: const Text('Rolls')),
          body: const Padding(
            padding: EdgeInsets.all(16),
            child: Text('Scaffold body 0123456789'),
          ),
          floatingActionButton: FloatingActionButton(
            onPressed: () {},
            child: const Icon(Icons.add),
          ),
        ),
        'scaffold-$mode',
      );
    });

    testWidgets('card $mode', (tester) async {
      await _pumpGolden(
        tester,
        theme,
        Scaffold(
          body: Center(
            child: SizedBox(
              width: 300,
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Kodak Portra 400', style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      Text('Card body text', style: theme.textTheme.bodyMedium),
                      const SizedBox(height: 12),
                      const Chip(label: Text('135')),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          FilledButton(onPressed: () {}, child: const Text('Load')),
                          const SizedBox(width: 8),
                          OutlinedButton(onPressed: () {}, child: const Text('Edit')),
                          const SizedBox(width: 8),
                          const TextButton(onPressed: null, child: Text('Off')),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
        'card-$mode',
      );
    });

    testWidgets('dialog $mode', (tester) async {
      await _pumpGolden(
        tester,
        theme,
        Scaffold(
          body: Center(
            child: AlertDialog(
              title: const Text('Unload roll?'),
              content: const Text('The roll returns to the fridge.'),
              actions: [
                TextButton(onPressed: () {}, child: const Text('Cancel')),
                FilledButton(onPressed: () {}, child: const Text('Unload')),
              ],
            ),
          ),
        ),
        'dialog-$mode',
      );
    });

    testWidgets('navigation bar $mode', (tester) async {
      await _pumpGolden(
        tester,
        theme,
        Scaffold(
          bottomNavigationBar: NavigationBar(
            selectedIndex: 0,
            destinations: const [
              NavigationDestination(icon: Icon(Icons.camera_roll), label: 'Rolls'),
              NavigationDestination(icon: Icon(Icons.photo_camera), label: 'Gear'),
              NavigationDestination(icon: Icon(Icons.more_horiz), label: 'More'),
            ],
          ),
        ),
        'navbar-$mode',
      );
    });
  }
}
