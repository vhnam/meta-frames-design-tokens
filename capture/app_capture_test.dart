// Disposable. v2 copy of baseline/capture/app_baseline_test.dart (sha256 4b06cda12526…). Run from
// meta-frames-app:
//   FLUTTER_ROOT=<sdk> CAPTURE_OUT=<dir> flutter test \
//     --packages=.dart_tool/package_config.json <this file>
// Writes app-resolved.json and goldens/*.png to CAPTURE_OUT. Reads the app, writes nothing else.
// APP_DIR points at another checkout's assets (used for the font probes).
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meta_frames/ui/core/theme.dart';

final _appDir = Platform.environment['APP_DIR'] ?? Directory.current.path;
final _out = Platform.environment['CAPTURE_OUT']!;

const _families = {
  'SpaceGrotesk': 'assets/fonts/SpaceGrotesk.ttf',
  'GeistMono': 'assets/fonts/GeistMono.ttf',
  'JetBrainsMono': 'assets/fonts/JetBrainsMono.ttf',
};
const _scales = [1.0, 2.0];

/// Writes every golden under CAPTURE_OUT/goldens. Nothing is compared.
class _WriteComparator extends GoldenFileComparator {
  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    await update(golden, imageBytes);
    return true;
  }

  @override
  Future<void> update(Uri golden, Uint8List imageBytes) async {
    final file = File('$_out/goldens/${golden.path}');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(imageBytes);
  }
}

/// A missing or unreadable asset throws, and so fails setUpAll.
Future<void> _loadFont(String family, String asset) async {
  final bytes = File('$_appDir/$asset').readAsBytesSync();
  final loader = FontLoader(family)
    ..addFont(Future.value(ByteData.view(bytes.buffer)));
  await loader.load();
}

double _width(String family, double size) {
  final painter = TextPainter(
    text: TextSpan(
      text: 'Sphinx of black quartz 0123456789',
      style: TextStyle(fontFamily: family, fontSize: size),
    ),
    textDirection: TextDirection.ltr,
  )..layout();
  return painter.width;
}

/// Registered family width and the width of a family that is not registered.
/// Equal widths mean the asset did not load and the sample used a fallback.
Map<String, Map<String, double>> _fontWidths() => {
  for (final family in _families.keys)
    family: {
      'registeredWidth': _width(family, 20),
      'fallbackWidth': _width('MfFamilyNotRegistered', 20),
    },
};

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

Map<String, Object?> _style(TextStyle? style) => {
  'family': style?.fontFamily,
  'size': style?.fontSize,
  'height': style?.height,
  'weight': style?.fontWeight?.value,
};

/// Top-left corner radius of a rounded shape. Null for any other shape, so the
/// comparison reports it instead of the capture failing.
double? _radius(Object? shape) {
  final radius = switch (shape) {
    RoundedRectangleBorder(:final borderRadius) => borderRadius,
    OutlineInputBorder(:final borderRadius) => borderRadius,
    _ => null,
  };
  return radius?.resolve(TextDirection.ltr).topLeft.x;
}

Map<String, Object?> _buttonBox(ButtonStyle style) {
  final padding = style.padding
      ?.resolve(const <WidgetState>{})
      ?.resolve(TextDirection.ltr);
  return {
    'paddingLeft': padding?.left,
    'paddingRight': padding?.right,
    'paddingTop': padding?.top,
    'paddingBottom': padding?.bottom,
    'minHeight': style.minimumSize?.resolve(const <WidgetState>{})?.height,
  };
}

Map<String, Object?> _values(ThemeData theme) {
  final nav = theme.navigationBarTheme;
  final text = theme.textButtonTheme.style!;
  final filled = theme.filledButtonTheme.style!;
  final outlined = theme.outlinedButtonTheme.style!;
  final segmented = theme.segmentedButtonTheme.style!;
  final focused =
      theme.inputDecorationTheme.focusedBorder as OutlineInputBorder;
  const selected = <WidgetState>{WidgetState.selected};
  const none = <WidgetState>{};
  const disabled = <WidgetState>{WidgetState.disabled};
  return {
    'brightness': theme.brightness.name,
    'colorScheme': _scheme(theme.colorScheme),
    'surfaces': {
      'card': _color(theme.cardTheme.color),
      'dialog': _color(theme.dialogTheme.backgroundColor),
    },
    'nav': {
      'backgroundColor': _color(nav.backgroundColor),
      'indicatorColor': _color(nav.indicatorColor),
      'labelSelected': _color(nav.labelTextStyle!.resolve(selected)!.color),
      'labelUnselected': _color(nav.labelTextStyle!.resolve(none)!.color),
      'iconSelected': _color(nav.iconTheme!.resolve(selected)!.color),
      'iconUnselected': _color(nav.iconTheme!.resolve(none)!.color),
    },
    'inputFocus': {
      'color': _color(focused.borderSide.color),
      'width': focused.borderSide.width,
    },
    'disabled': {
      'textButtonForeground': _color(text.foregroundColor!.resolve(disabled)),
      'textButtonIcon': _color(text.iconColor!.resolve(disabled)),
    },
    'sizes': {
      'appBarTitle': _style(theme.appBarTheme.titleTextStyle),
      'dialogTitle': _style(theme.dialogTheme.titleTextStyle),
      'buttonText': _style(filled.textStyle?.resolve(none)),
      'inputLabel': _style(theme.inputDecorationTheme.labelStyle),
      'chipLabel': _style(theme.chipTheme.labelStyle),
      'tabLabel': _style(theme.tabBarTheme.labelStyle),
      'segmentLabel': _style(segmented.textStyle?.resolve(none)),
      'monoStyleDefault': _style(monoStyle()),
      'navLabel': _style(nav.labelTextStyle!.resolve(none)),
    },
    'radii': {
      'card': _radius(theme.cardTheme.shape),
      'dialog': _radius(theme.dialogTheme.shape),
      'bottomSheetTop': switch (theme.bottomSheetTheme.shape) {
        RoundedRectangleBorder(:final borderRadius) =>
          borderRadius.resolve(TextDirection.ltr).topLeft.x,
        _ => null,
      },
      'popupMenu': _radius(theme.popupMenuTheme.shape),
      'filledButton': _radius(filled.shape?.resolve(none)),
      'outlinedButton': _radius(outlined.shape?.resolve(none)),
      'textButton': _radius(text.shape?.resolve(none)),
      'floatingActionButton': _radius(theme.floatingActionButtonTheme.shape),
      'inputBorder': _radius(theme.inputDecorationTheme.border),
      'segmentedButton': _radius(segmented.shape?.resolve(none)),
      'navIndicator': _radius(nav.indicatorShape),
    },
    'button': {'filled': _buttonBox(filled), 'outlined': _buttonBox(outlined)},
  };
}

typedef _Slot = TextStyle? Function(TextTheme);

final _slots = <String, _Slot>{
  'displayLarge': (theme) => theme.displayLarge,
  'displayMedium': (theme) => theme.displayMedium,
  'displaySmall': (theme) => theme.displaySmall,
  'headlineLarge': (theme) => theme.headlineLarge,
  'headlineMedium': (theme) => theme.headlineMedium,
  'headlineSmall': (theme) => theme.headlineSmall,
  'titleLarge': (theme) => theme.titleLarge,
  'titleMedium': (theme) => theme.titleMedium,
  'titleSmall': (theme) => theme.titleSmall,
  'labelLarge': (theme) => theme.labelLarge,
  'labelMedium': (theme) => theme.labelMedium,
  'labelSmall': (theme) => theme.labelSmall,
  'bodyLarge': (theme) => theme.bodyLarge,
  'bodyMedium': (theme) => theme.bodyMedium,
  'bodySmall': (theme) => theme.bodySmall,
};

/// Body, data (mono) and heading samples.
final _sampleSlots = <String, _Slot>{
  'body': (theme) => theme.bodyMedium,
  'data': (theme) => theme.labelMedium,
  'heading': (theme) => theme.headlineMedium,
};

/// Renders one Text per slot inside MaterialApp and reads the style that
/// reached the paragraph, and its laid-out size, at the current text scale.
/// The app's own TextTheme has no Material sizes until MaterialApp localizes
/// it, so the rendered style is the effective one.
Future<Map<String, Map<String, Object?>>> _rendered(
  WidgetTester tester,
  ThemeData theme,
  Map<String, _Slot> slots,
) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: theme,
      home: Scaffold(
        body: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final entry in slots.entries)
                Builder(
                  builder: (context) => Text(
                    'Sample 0123 ${entry.key}',
                    key: Key(entry.key),
                    style: entry.value(Theme.of(context).textTheme),
                  ),
                ),
            ],
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return {
    for (final name in slots.keys)
      name: () {
        final paragraph = tester.renderObject<RenderParagraph>(
          find.byKey(Key(name)),
        );
        return {
          ..._style((paragraph.text as TextSpan).style),
          'boxWidth': paragraph.size.width,
          'boxHeight': paragraph.size.height,
        };
      }(),
  };
}

Future<void> _pumpGolden(
  WidgetTester tester,
  ThemeData theme,
  Widget home,
  String name,
  double scale,
) async {
  tester.view.physicalSize = const Size(400, 640);
  tester.view.devicePixelRatio = 1.0;
  tester.platformDispatcher.textScaleFactorTestValue = scale;
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  await tester.pumpWidget(
    MaterialApp(debugShowCheckedModeBanner: false, theme: theme, home: home),
  );
  await tester.pumpAndSettle();
  await expectLater(
    find.byType(MaterialApp),
    matchesGoldenFile('$name-${scale.toInt()}x.png'),
  );
}

void main() {
  setUpAll(() async {
    goldenFileComparator = _WriteComparator();
    final flutterRoot = Platform.environment['FLUTTER_ROOT']!;
    final icons = File(
      '$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    ).readAsBytesSync();
    await (FontLoader(
      'MaterialIcons',
    )..addFont(Future.value(ByteData.view(icons.buffer)))).load();
    for (final entry in _families.entries) {
      await _loadFont(entry.key, entry.value);
    }
    // A font that did not load renders in the fallback face and is not evidence.
    for (final entry in _fontWidths().entries) {
      if (entry.value['registeredWidth'] == entry.value['fallbackWidth']) {
        throw StateError(
          '${entry.key} renders like an unregistered family: the asset did not load',
        );
      }
    }
  });

  testWidgets('write resolved values', (tester) async {
    final data = <String, Object?>{'schema': 2, 'fonts': _fontWidths()};
    for (final entry in {
      'light': buildTheme(Brightness.light),
      'dark': buildTheme(Brightness.dark),
    }.entries) {
      tester.platformDispatcher.textScaleFactorTestValue = 1.0;
      final slots = await _rendered(tester, entry.value, _slots);
      final samples = <String, Object?>{};
      for (final scale in _scales) {
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        samples['$scale'] = await _rendered(tester, entry.value, _sampleSlots);
      }
      tester.platformDispatcher.clearTextScaleFactorTestValue();
      data[entry.key] = {
        ..._values(entry.value),
        'text': {
          for (final slot in slots.entries)
            slot.key: {
              for (final field in const ['family', 'size', 'height', 'weight'])
                field: slot.value[field],
            },
        },
        'samples': samples,
      };
    }
    File('$_out/app-resolved.json')
      ..parent.createSync(recursive: true)
      ..writeAsStringSync(
        '${const JsonEncoder.withIndent('  ').convert(data)}\n',
      );
  });

  for (final brightness in Brightness.values) {
    final mode = brightness.name;
    final theme = buildTheme(brightness);

    for (final scale in _scales) {
      testWidgets('scaffold $mode ${scale}x', (tester) async {
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
          scale,
        );
      });

      testWidgets('card $mode ${scale}x', (tester) async {
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
                        Text(
                          'Kodak Portra 400',
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Card body text',
                          style: theme.textTheme.bodyMedium,
                        ),
                        const SizedBox(height: 12),
                        const Chip(label: Text('135')),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          children: [
                            FilledButton(
                              onPressed: () {},
                              child: const Text('Load'),
                            ),
                            OutlinedButton(
                              onPressed: () {},
                              child: const Text('Edit'),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        const TextField(
                          decoration: InputDecoration(labelText: 'Notes'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          'card-$mode',
          scale,
        );
      });

      testWidgets('dialog $mode ${scale}x', (tester) async {
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
          scale,
        );
      });

      for (final selectedIndex in [0, 2]) {
        final state = selectedIndex == 0 ? 'selected' : 'idle';
        testWidgets('navigation bar $state $mode ${scale}x', (tester) async {
          await _pumpGolden(
            tester,
            theme,
            Scaffold(
              bottomNavigationBar: NavigationBar(
                selectedIndex: selectedIndex,
                destinations: const [
                  NavigationDestination(
                    icon: Icon(Icons.camera_roll),
                    label: 'Rolls',
                  ),
                  NavigationDestination(
                    icon: Icon(Icons.photo_camera),
                    label: 'Gear',
                  ),
                  NavigationDestination(
                    icon: Icon(Icons.more_horiz),
                    label: 'More',
                  ),
                ],
              ),
            ),
            'navbar-$state-$mode',
            scale,
          );
        });
      }

      testWidgets('disabled controls $mode ${scale}x', (tester) async {
        await _pumpGolden(
          tester,
          theme,
          Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(16),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  const FilledButton(onPressed: null, child: Text('Filled')),
                  const OutlinedButton(
                    onPressed: null,
                    child: Text('Outlined'),
                  ),
                  const TextButton(onPressed: null, child: Text('Text')),
                  TextButton.icon(
                    onPressed: null,
                    icon: const Icon(Icons.add),
                    label: const Text('Icon'),
                  ),
                ],
              ),
            ),
          ),
          'disabled-$mode',
          scale,
        );
      });

      testWidgets('body text $mode ${scale}x', (tester) async {
        await _pumpGolden(
          tester,
          theme,
          Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Body large 0123', style: theme.textTheme.bodyLarge),
                  Text('Body medium 0123', style: theme.textTheme.bodyMedium),
                  Text('Body small 0123', style: theme.textTheme.bodySmall),
                  Text('Heading 0123', style: theme.textTheme.headlineMedium),
                ],
              ),
            ),
          ),
          'text-body-$mode',
          scale,
        );
      });

      testWidgets('data text $mode ${scale}x', (tester) async {
        await _pumpGolden(
          tester,
          theme,
          Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Label large 0123', style: theme.textTheme.labelLarge),
                  Text('Label medium 0123', style: theme.textTheme.labelMedium),
                  Text('Label small 0123', style: theme.textTheme.labelSmall),
                  Text('Title small 0123', style: theme.textTheme.titleSmall),
                ],
              ),
            ),
          ),
          'text-data-$mode',
          scale,
        );
      });
    }
  }
}
