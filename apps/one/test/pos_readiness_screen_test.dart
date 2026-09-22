// TASK 16.17 — widget tests for `PosReadinessScreen` ("Configuración") with a
// fake gateway. Every fixture name here is deliberately generic: the screen
// must render whatever the backend reports and never depend on a tenant.
library;

import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_navigation.dart';
import 'package:as_one/features/pos/pos_readiness_gateway.dart';
import 'package:as_one/features/pos/pos_readiness_presentation.dart';
import 'package:as_one/features/pos/pos_readiness_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _readPermissions = ['branch.read'];

void main() {
  group('fully configured branch', () {
    testWidgets('shows the green banner, every applicable stage Listo and inventory No aplica', (tester) async {
      final gateway = _FakeGateway(_tenant(branches: [_branch(name: 'Sucursal QA', stages: _stagesReadyNoInventory)]));
      await _pump(tester, gateway: gateway);

      expect(find.text('Configuración'), findsOneWidget);
      expect(
        find.text('Estado de la configuración de tu empresa: qué está listo y qué falta para vender.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('pos-readiness-banner-ready')), findsOneWidget);
      expect(find.text('Tu sucursal está lista para vender.'), findsOneWidget);
      for (final key in ['administration', 'pos_entry', 'register_open', 'sale']) {
        expect(_inStage(key, 'Listo'), findsOneWidget, reason: key);
      }
      expect(_inStage('inventory', 'No aplica'), findsOneWidget);
      // A single branch never shows the picker.
      expect(find.byKey(const Key('pos-readiness-branch-picker')), findsNothing);
      expect(gateway.calls, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders without overflow at 800x600 and 1440x900', (tester) async {
      final data = _tenant(branches: [_branch(name: 'Sucursal QA', stages: _stagesReadyNoInventory)]);
      await _pump(tester, gateway: _FakeGateway(data), size: const Size(800, 600));
      expect(tester.takeException(), isNull);
      await _pump(tester, gateway: _FakeGateway(data), size: const Size(1440, 900));
      expect(tester.takeException(), isNull);
    });
  });

  group('required vs optional', () {
    testWidgets('operational areas are Opcional with no required badge; register is Requerido', (tester) async {
      final gateway = _FakeGateway(
        _tenant(
          branches: [
            _branch(
              name: 'Sucursal QA',
              stages: _stagesReadyNoInventory,
              checks: [
                _check('register_exists', surface: 'registers', count: 2),
                _check(
                  'operational_areas',
                  required: false,
                  status: 'optional_missing',
                  surface: 'operational_areas',
                  count: 0,
                ),
              ],
            ),
          ],
        ),
      );
      await _pump(tester, gateway: gateway);

      final requiredSection = find.byKey(const Key('pos-readiness-section-required'));
      final optionalSection = find.byKey(const Key('pos-readiness-section-optional'));
      expect(
        find.descendant(of: requiredSection, matching: find.byKey(const Key('pos-readiness-row-register_exists'))),
        findsOneWidget,
      );
      expect(
        find.descendant(of: optionalSection, matching: find.byKey(const Key('pos-readiness-row-operational_areas'))),
        findsOneWidget,
      );
      // The optional row is never in the required section and carries no
      // "Requerido" text of its own.
      expect(
        find.descendant(of: requiredSection, matching: find.byKey(const Key('pos-readiness-row-operational_areas'))),
        findsNothing,
      );
      expect(
        find.descendant(
          of: find.byKey(const Key('pos-readiness-row-operational_areas')),
          matching: find.textContaining('Requerido'),
        ),
        findsNothing,
      );
      expect(find.text('Requerido'), findsOneWidget); // only the section header
      expect(find.text('Opcional'), findsOneWidget);
      // An optional gap never blocks the sale banner.
      expect(find.byKey(const Key('pos-readiness-banner-ready')), findsOneWidget);
      expect(find.text('Opcional por ahora.'), findsNothing);
    });

    testWidgets('not_applicable rows are still rendered, greyed, with their detail text', (tester) async {
      final gateway = _FakeGateway(
        _tenant(
          branches: [
            _branch(
              name: 'Sucursal QA',
              stages: _stagesReadyNoInventory,
              checks: [_check('operator_register_access', status: 'not_applicable', surface: 'users')],
            ),
          ],
        ),
      );
      await _pump(tester, gateway: gateway);

      final row = find.byKey(const Key('pos-readiness-row-operator_register_access'));
      expect(row, findsOneWidget);
      expect(
        find.descendant(of: row, matching: find.text('Se evalúa cuando existan una caja y un usuario autorizado.')),
        findsOneWidget,
      );
      expect(find.descendant(of: row, matching: find.byIcon(Icons.remove_circle_outline)), findsOneWidget);
      // No fix-it button for a check that does not apply.
      expect(find.byKey(const Key('pos-readiness-cta-operator_register_access')), findsNothing);
    });
  });

  group('missing pieces and their fix-it buttons', () {
    testWidgets('missing register: row + CTA "Ir a Corte de Caja" navigates to cash', (tester) async {
      final navigated = <PosModule>[];
      final gateway = _FakeGateway(
        _tenant(
          branches: [
            _branch(
              name: 'Sucursal QA',
              stages: _stagesBlocked,
              checks: [_check('register_exists', status: 'missing', surface: 'registers', count: 0)],
            ),
          ],
        ),
      );
      await _pump(tester, gateway: gateway, onNavigate: navigated.add);

      expect(find.byKey(const Key('pos-readiness-row-register_exists')), findsOneWidget);
      expect(find.text('Crea al menos una caja en esta sucursal.'), findsOneWidget);
      expect(find.byIcon(Icons.error), findsWidgets);
      expect(find.text('Ir a Corte de Caja'), findsOneWidget);
      await tester.tap(find.byKey(const Key('pos-readiness-cta-register_exists')));
      expect(navigated, [PosModule.cash]);
    });

    testWidgets('missing user access: CTA "Ir a Usuarios" navigates to users', (tester) async {
      final navigated = <PosModule>[];
      final gateway = _FakeGateway(
        _tenant(
          branches: [
            _branch(
              name: 'Sucursal QA',
              stages: _stagesBlocked,
              checks: [_check('operator_authorized', status: 'missing', surface: 'users', count: 0)],
            ),
          ],
        ),
      );
      await _pump(tester, gateway: gateway, onNavigate: navigated.add);

      expect(find.byKey(const Key('pos-readiness-row-operator_authorized')), findsOneWidget);
      expect(find.text('Ir a Usuarios'), findsOneWidget);
      await tester.tap(find.byKey(const Key('pos-readiness-cta-operator_authorized')));
      expect(navigated, [PosModule.users]);
    });

    testWidgets('missing catalog: CTA "Ir a Productos" navigates to products', (tester) async {
      final navigated = <PosModule>[];
      final gateway = _FakeGateway(
        _tenant(
          branches: [
            _branch(
              name: 'Sucursal QA',
              stages: _stagesBlocked,
              checks: [_check('catalog_products', status: 'missing', surface: 'catalog', count: 0)],
            ),
          ],
        ),
      );
      await _pump(tester, gateway: gateway, onNavigate: navigated.add);

      expect(find.text('Crea tu primer producto activo.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('pos-readiness-cta-catalog_products')));
      expect(navigated, [PosModule.products]);
    });

    testWidgets('missing price: the backend-named products are listed under the row', (tester) async {
      final navigated = <PosModule>[];
      final gateway = _FakeGateway(
        _tenant(
          branches: [
            _branch(
              name: 'Sucursal QA',
              stages: _stagesBlocked,
              checks: [
                _check(
                  'product_prices',
                  status: 'warning',
                  surface: 'prices',
                  count: 2,
                  items: const [
                    PosReadinessItem(id: 'p-1', label: 'Producto X requiere un precio de venta activo'),
                    PosReadinessItem(id: 'p-2', label: 'Producto Y requiere un precio de venta activo'),
                  ],
                ),
              ],
            ),
          ],
        ),
      );
      await _pump(tester, gateway: gateway, onNavigate: navigated.add);

      final row = find.byKey(const Key('pos-readiness-row-product_prices'));
      expect(
        find.descendant(of: row, matching: find.text('Producto X requiere un precio de venta activo')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: row, matching: find.text('Producto Y requiere un precio de venta activo')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: row, matching: find.text('2 productos requieren un precio de venta activo:')),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('pos-readiness-cta-product_prices')));
      expect(navigated, [PosModule.products]);
    });

    testWidgets('missing inventory location is Requerido and points to Admin. Inventario', (tester) async {
      final navigated = <PosModule>[];
      final gateway = _FakeGateway(
        _tenant(
          branches: [
            _branch(
              name: 'Sucursal QA',
              stages: _stagesBlocked,
              checks: [
                _check('inventory_location', status: 'missing', surface: 'inventory_locations', count: 0),
              ],
            ),
          ],
        ),
      );
      await _pump(tester, gateway: gateway, onNavigate: navigated.add);

      expect(
        find.descendant(
          of: find.byKey(const Key('pos-readiness-section-required')),
          matching: find.byKey(const Key('pos-readiness-row-inventory_location')),
        ),
        findsOneWidget,
      );
      expect(find.text('Ir a Admin. Inventario'), findsOneWidget);
      await tester.tap(find.byKey(const Key('pos-readiness-cta-inventory_location')));
      expect(navigated, [PosModule.inventoryAdmin]);
    });

    testWidgets('a company-level fault has no fix-it button (support matter)', (tester) async {
      final gateway = _FakeGateway(
        _tenant(
          companyChecks: [_check('company_timezone_valid', status: 'missing', scope: 'company', surface: 'company')],
          branches: [_branch(name: 'Sucursal QA', stages: _stagesBlocked)],
        ),
      );
      await _pump(tester, gateway: gateway);

      expect(find.byKey(const Key('pos-readiness-row-company_timezone_valid')), findsOneWidget);
      expect(find.byKey(const Key('pos-readiness-cta-company_timezone_valid')), findsNothing);
    });
  });

  group('stages and banner', () {
    testWidgets('ready to open the register but not ready to sell: amber banner, mixed chips', (tester) async {
      final gateway = _FakeGateway(
        _tenant(
          branches: [
            _branch(
              name: 'Sucursal QA',
              stages: [
                _stage('administration', true),
                _stage('pos_entry', true),
                _stage('register_open', true),
                _stage('sale', false),
                _stage('inventory', null),
              ],
            ),
          ],
        ),
      );
      await _pump(tester, gateway: gateway);

      expect(_inStage('register_open', 'Listo'), findsOneWidget);
      expect(_inStage('sale', 'Pendiente'), findsOneWidget);
      expect(find.byKey(const Key('pos-readiness-banner-pending')), findsOneWidget);
      expect(find.text('Aún faltan pasos para poder vender.'), findsOneWidget);
      expect(find.byKey(const Key('pos-readiness-banner-ready')), findsNothing);
    });

    testWidgets('ready to sell with inventory controlled: every chip Listo and green banner', (tester) async {
      final gateway = _FakeGateway(
        _tenant(
          branches: [
            _branch(
              name: 'Sucursal QA',
              stages: [
                _stage('administration', true),
                _stage('pos_entry', true),
                _stage('register_open', true),
                _stage('sale', true),
                _stage('inventory', true),
              ],
            ),
          ],
        ),
      );
      await _pump(tester, gateway: gateway);

      for (final key in posReadinessStageOrder) {
        expect(_inStage(key, 'Listo'), findsOneWidget, reason: key);
      }
      expect(find.byKey(const Key('pos-readiness-banner-ready')), findsOneWidget);
    });
  });

  group('branches', () {
    testWidgets('multi-branch picker defaults to the current branch and switches the shown checks', (tester) async {
      final gateway = _FakeGateway(
        _tenant(
          branches: [
            _branch(
              id: 'b-1',
              name: 'Sucursal QA',
              stages: _stagesReadyNoInventory,
              checks: [_check('register_exists', surface: 'registers', count: 1)],
            ),
            _branch(
              id: 'b-2',
              name: 'Sucursal QA Dos',
              stages: _stagesBlocked,
              checks: [_check('catalog_products', status: 'missing', surface: 'catalog', count: 0)],
            ),
          ],
        ),
      );
      // The context's current branch is b-2.
      await _pump(tester, gateway: gateway, currentBranchId: 'b-2');

      expect(find.byKey(const Key('pos-readiness-branch-picker')), findsOneWidget);
      expect(find.byKey(const Key('pos-readiness-row-catalog_products')), findsOneWidget);
      expect(find.byKey(const Key('pos-readiness-row-register_exists')), findsNothing);
      expect(find.byKey(const Key('pos-readiness-banner-pending')), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-readiness-branch-picker')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sucursal QA').last);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-readiness-row-register_exists')), findsOneWidget);
      expect(find.byKey(const Key('pos-readiness-row-catalog_products')), findsNothing);
      expect(find.byKey(const Key('pos-readiness-banner-ready')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a tenant with zero branches shows company checks, the administration chip and an explanation', (
      tester,
    ) async {
      final gateway = _FakeGateway(
        _tenant(
          administrationReady: false,
          companyChecks: [
            _check('company_active', scope: 'company', surface: 'company'),
            _check('branch_exists', status: 'missing', scope: 'company', surface: 'branches', count: 0),
          ],
          branches: const [],
        ),
      );
      await _pump(tester, gateway: gateway);

      expect(find.byKey(const Key('pos-readiness-no-branches')), findsOneWidget);
      expect(_inStage('administration', 'Pendiente'), findsOneWidget);
      for (final key in ['pos_entry', 'register_open', 'sale', 'inventory']) {
        expect(find.byKey(Key('pos-readiness-stage-$key')), findsNothing, reason: key);
      }
      expect(find.byKey(const Key('pos-readiness-row-company_active')), findsOneWidget);
      expect(find.byKey(const Key('pos-readiness-row-branch_exists')), findsOneWidget);
      expect(find.byKey(const Key('pos-readiness-branch-picker')), findsNothing);
      expect(find.byKey(const Key('pos-readiness-banner-pending')), findsOneWidget);
      expect(find.text('Ir a Sucursales'), findsOneWidget);
    });
  });

  group('permissions, failure and tenant neutrality', () {
    testWidgets('without branch.read the screen shows a permission state and never calls the gateway', (
      tester,
    ) async {
      final gateway = _FakeGateway(_tenant(branches: [_branch(name: 'Sucursal QA', stages: _stagesBlocked)]));
      await _pump(tester, gateway: gateway, permissions: const ['catalog.read']);

      expect(find.byKey(const Key('pos-readiness-permission-denied')), findsOneWidget);
      expect(find.textContaining('branch.read'), findsOneWidget);
      expect(find.byKey(const Key('pos-readiness-banner-ready')), findsNothing);
      expect(gateway.calls, 0);
      // The refresh button is inert as well.
      await tester.tap(find.byKey(const Key('pos-readiness-refresh')), warnIfMissed: false);
      await tester.pump();
      expect(gateway.calls, 0);
    });

    testWidgets('a failing load shows the error with Reintentar, which reloads', (tester) async {
      final gateway = _FakeGateway(
        _tenant(branches: [_branch(name: 'Sucursal QA', stages: _stagesReadyNoInventory)]),
        failFirst: 1,
      );
      await _pump(tester, gateway: gateway);

      expect(find.text('Fallo simulado.'), findsOneWidget);
      expect(find.text('Reintentar'), findsOneWidget);
      expect(find.byKey(const Key('pos-readiness-banner-ready')), findsNothing);

      await tester.tap(find.text('Reintentar'));
      await tester.pumpAndSettle();

      expect(gateway.calls, 2);
      expect(find.text('Fallo simulado.'), findsNothing);
      expect(find.byKey(const Key('pos-readiness-banner-ready')), findsOneWidget);
    });

    testWidgets('the Refresh button reloads the checklist', (tester) async {
      final gateway = _FakeGateway(_tenant(branches: [_branch(name: 'Sucursal QA', stages: _stagesBlocked)]));
      await _pump(tester, gateway: gateway);
      expect(gateway.calls, 1);

      await tester.tap(find.byKey(const Key('pos-readiness-refresh')));
      await tester.pumpAndSettle();
      expect(gateway.calls, 2);
    });

    testWidgets('a USD tenant renders identically with nothing MXN-specific', (tester) async {
      final gateway = _FakeGateway(
        _tenant(
          currency: 'USD',
          branches: [
            _branch(
              name: 'Sucursal QA',
              stages: _stagesReadyNoInventory,
              checks: [
                _check('register_exists', surface: 'registers', count: 3),
                _check(
                  'price_currency',
                  status: 'warning',
                  surface: 'prices',
                  count: 1,
                  items: const [PosReadinessItem(id: 'p-1', label: 'Producto Z tiene precio en otra moneda')],
                ),
              ],
            ),
          ],
        ),
      );
      await _pump(tester, gateway: gateway, currency: 'USD');

      expect(find.byKey(const Key('pos-readiness-banner-ready')), findsOneWidget);
      expect(find.byKey(const Key('pos-readiness-row-price_currency')), findsOneWidget);
      expect(find.textContaining('MXN'), findsNothing);
      expect(find.textContaining('México'), findsNothing);
    });

    testWidgets('generic non-tenant names are rendered exactly as reported', (tester) async {
      final gateway = _FakeGateway(
        _tenant(
          companyName: 'Empresa Generica QA',
          branches: [
            _branch(id: 'b-1', name: 'Sucursal QA', stages: _stagesReadyNoInventory),
            _branch(id: 'b-2', name: 'Sucursal QA Dos', stages: _stagesBlocked),
          ],
        ),
      );
      await _pump(tester, gateway: gateway);

      expect(find.text('Empresa Generica QA · Sucursal QA'), findsOneWidget);
      expect(find.byKey(const Key('pos-readiness-banner-ready')), findsOneWidget);
    });
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

Finder _inStage(String key, String text) =>
    find.descendant(of: find.byKey(Key('pos-readiness-stage-$key')), matching: find.text(text));

PosReadinessStage _stage(String key, bool? ready) => PosReadinessStage(key: key, ready: ready, blockedBy: const []);

final _stagesReadyNoInventory = [
  _stage('administration', true),
  _stage('pos_entry', true),
  _stage('register_open', true),
  _stage('sale', true),
  _stage('inventory', null),
];

final _stagesBlocked = [
  _stage('administration', true),
  _stage('pos_entry', false),
  _stage('register_open', false),
  _stage('sale', false),
  _stage('inventory', null),
];

PosReadinessCheck _check(
  String code, {
  String status = 'ok',
  bool required = true,
  String scope = 'branch',
  String surface = '',
  int? count,
  List<PosReadinessItem> items = const [],
}) => PosReadinessCheck(
  code: code,
  scope: scope,
  required: required,
  status: PosReadinessStatus.parse(status),
  surface: surface,
  count: count,
  items: items,
);

PosBranchReadiness _branch({
  String id = 'b-1',
  required String name,
  required List<PosReadinessStage> stages,
  List<PosReadinessCheck> checks = const [],
}) => PosBranchReadiness(branchId: id, code: id.toUpperCase(), name: name, checks: checks, stages: stages);

PosTenantReadiness _tenant({
  required List<PosBranchReadiness> branches,
  String companyName = 'Empresa Generica QA',
  String currency = 'MXN',
  bool administrationReady = true,
  List<PosReadinessCheck> companyChecks = const [],
}) => PosTenantReadiness(
  evaluatedAt: '2026-09-21T10:00:00.000Z',
  companyId: 'company-id',
  companyName: companyName,
  currencyCode: currency,
  timezone: 'UTC',
  administrationReady: administrationReady,
  companyChecks: companyChecks,
  branches: branches,
);

class _FakeGateway implements PosReadinessGateway {
  _FakeGateway(this.data, {this.failFirst = 0});
  final PosTenantReadiness data;
  final int failFirst;
  int calls = 0;

  @override
  Future<PosTenantReadiness> readiness({String? branchId}) async {
    calls++;
    if (calls <= failFirst) {
      throw ApiException(const AppFailure(AppErrorKind.unknown, 'Fallo simulado.', code: 'internal_error'));
    }
    return data;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required _FakeGateway gateway,
  List<String> permissions = _readPermissions,
  void Function(PosModule module)? onNavigate,
  Size size = const Size(1440, 900),
  String currentBranchId = 'b-1',
  String currency = 'MXN',
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: PosReadinessScreen(
            context: _context(permissions, currentBranchId: currentBranchId, currency: currency),
            gateway: gateway,
            onNavigate: onNavigate ?? (_) {},
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

AuthenticatedContext _context(
  List<String> permissions, {
  required String currentBranchId,
  required String currency,
}) => AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: currentBranchId,
    permittedBranchIds: const ['b-1', 'b-2'],
    companyWideAccess: false,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Usuario QA', email: 'user@example.test'),
  companies: [CompanySummary(id: 'company-id', name: 'Empresa Generica QA', current: true, currencyCode: currency)],
  branches: [
    BranchSummary(id: 'b-1', code: 'B-1', name: 'Sucursal QA', timezone: 'UTC', current: currentBranchId == 'b-1'),
    BranchSummary(id: 'b-2', code: 'B-2', name: 'Sucursal QA Dos', timezone: 'UTC', current: currentBranchId == 'b-2'),
  ],
  companyWideAccess: false,
  permissions: permissions,
);
