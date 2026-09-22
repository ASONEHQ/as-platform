/// TASK 16.17 — commercial Spanish copy and routing for the tenant
/// readiness surface ("Configuración"). Presentation ONLY: the backend's
/// `GET /api/v1/readiness` is the sole authority on what is ready, what is
/// missing and what is optional — nothing here decides that. This file
/// merely turns the backend's stable machine codes into words a business
/// owner understands and into the existing administration module that fixes
/// each item, so no widget switches on a check code itself.
///
/// Deliberately tenant-neutral: no example in this copy names any real
/// customer, branch, area, register or product — operational areas in
/// particular are tenant-defined, never seeded (TASK 16.15).
library;

import 'pos_navigation.dart';

/// The backend's status vocabulary (`readiness.types.ts` `ReadinessStatus`).
enum PosReadinessStatus {
  ok,
  missing,
  warning,
  optionalMissing,
  notApplicable;

  static PosReadinessStatus parse(String raw) => switch (raw) {
    'ok' => PosReadinessStatus.ok,
    'missing' => PosReadinessStatus.missing,
    'warning' => PosReadinessStatus.warning,
    'optional_missing' => PosReadinessStatus.optionalMissing,
    _ => PosReadinessStatus.notApplicable,
  };
}

/// The backend's stage keys, in the order the checklist presents them.
const List<String> posReadinessStageOrder = [
  'administration',
  'pos_entry',
  'register_open',
  'sale',
  'inventory',
];

String posReadinessStageLabel(String key) => switch (key) {
  'administration' => 'Administración lista',
  'pos_entry' => 'Listo para entrar al POS',
  'register_open' => 'Listo para abrir caja',
  'sale' => 'Listo para vender',
  'inventory' => 'Inventario controlado',
  _ => key,
};

String posReadinessStageHint(String key) => switch (key) {
  'administration' => 'Empresa, moneda, zona horaria y al menos una sucursal.',
  'pos_entry' => 'Una caja y un usuario que pueda entrar al punto de venta.',
  'register_open' => 'Un usuario autorizado con acceso a una caja de la sucursal.',
  'sale' => 'Un producto activo con precio de venta activo (y existencias si controla inventario).',
  'inventory' => 'Una ubicación de inventario predeterminada en la sucursal.',
  _ => '',
};

/// Short title of one check (a row in the checklist).
String posReadinessCheckTitle(String code) => switch (code) {
  'company_active' => 'Empresa activa',
  'company_currency_supported' => 'Moneda de la empresa',
  'company_timezone_valid' => 'Zona horaria de la empresa',
  'branch_exists' => 'Sucursal',
  'branch_timezone_valid' => 'Zona horaria de la sucursal',
  'operational_areas' => 'Áreas operativas',
  'register_exists' => 'Cajas',
  'register_area_consistent' => 'Cajas y áreas coherentes',
  'operator_authorized' => 'Usuario que puede cobrar',
  'operator_register_access' => 'Acceso a una caja',
  'catalog_products' => 'Catálogo',
  'product_prices' => 'Precios de venta',
  'price_currency' => 'Moneda de los precios',
  'inventory_location' => 'Ubicación de inventario',
  'inventory_stock' => 'Existencias',
  'cash_session_open' => 'Caja abierta',
  _ => code,
};

/// The plain-language sentence under a check's title, chosen from its real
/// backend [status] (and [count], when the backend supplies one). Never
/// claims a status the backend did not report.
String posReadinessCheckDetail({
  required String code,
  required PosReadinessStatus status,
  required int? count,
  required bool required,
}) {
  final n = count ?? 0;
  String plural(String one, String many) => n == 1 ? one : many;
  switch (code) {
    case 'company_active':
      return status == PosReadinessStatus.ok
          ? 'La empresa está activa.'
          : 'La empresa no está activa. Contacta a soporte de ACCESS GO.';
    case 'company_currency_supported':
      return status == PosReadinessStatus.ok
          ? 'La moneda de la empresa está soportada para operar caja.'
          : 'La moneda configurada aún no está soportada para abrir y cerrar caja. Contacta a soporte de ACCESS GO.';
    case 'company_timezone_valid':
      return status == PosReadinessStatus.ok
          ? 'La zona horaria de la empresa es válida.'
          : 'La zona horaria de la empresa no es válida. Contacta a soporte de ACCESS GO.';
    case 'branch_exists':
      return status == PosReadinessStatus.ok
          ? '$n ${plural('sucursal activa', 'sucursales activas')}.'
          : 'Crea al menos una sucursal para empezar a operar.';
    case 'branch_timezone_valid':
      return status == PosReadinessStatus.ok
          ? 'La zona horaria de la sucursal es válida.'
          : 'La zona horaria de la sucursal no es válida y bloquearía las ventas. Corrígela en Sucursales.';
    case 'operational_areas':
      return status == PosReadinessStatus.ok
          ? '$n ${plural('área operativa', 'áreas operativas')} para agrupar tus cajas.'
          : 'No usas áreas operativas y no las necesitas. Son opcionales: sirven para agrupar tus cajas por área de tu negocio y consolidar por área.';
    case 'register_exists':
      return status == PosReadinessStatus.ok
          ? '$n ${plural('caja configurada', 'cajas configuradas')} en esta sucursal.'
          : 'Crea al menos una caja en esta sucursal.';
    case 'register_area_consistent':
      return status == PosReadinessStatus.ok
          ? 'Todas las cajas con área apuntan a un área de su propia sucursal.'
          : '$n ${plural('caja apunta', 'cajas apuntan')} a un área que ya no pertenece a esta sucursal. Reasígnala${n == 1 ? '' : 's'}.';
    case 'operator_authorized':
      return status == PosReadinessStatus.ok
          ? '$n ${plural('usuario puede', 'usuarios pueden')} abrir caja y cobrar en esta sucursal.'
          : 'Ningún usuario activo puede abrir caja y cobrar en esta sucursal. Crea un usuario con un rol de Cajero o Gerente y dale acceso a la sucursal.';
    case 'operator_register_access':
      return switch (status) {
        PosReadinessStatus.ok => 'Al menos un usuario autorizado puede usar una caja de esta sucursal.',
        PosReadinessStatus.notApplicable => 'Se evalúa cuando existan una caja y un usuario autorizado.',
        _ =>
          'Los usuarios que pueden cobrar tienen su acceso limitado a cajas o áreas que no existen en esta sucursal. Revisa su acceso a caja/área.',
      };
    case 'catalog_products':
      return status == PosReadinessStatus.ok
          ? '$n ${plural('producto activo', 'productos activos')}.'
          : 'Crea tu primer producto activo.';
    case 'product_prices':
      return switch (status) {
        PosReadinessStatus.ok => 'Todos los productos activos tienen un precio de venta activo.',
        PosReadinessStatus.warning =>
          '$n ${plural('producto requiere', 'productos requieren')} un precio de venta activo:',
        PosReadinessStatus.notApplicable => 'Se evalúa cuando exista al menos un producto activo.',
        _ => 'Ningún producto activo tiene un precio de venta activo, así que aún no se puede vender.',
      };
    case 'price_currency':
      return status == PosReadinessStatus.ok
          ? 'Todos los precios usan la moneda de la empresa.'
          : '$n ${plural('producto tiene', 'productos tienen')} precio en una moneda distinta a la de la empresa y no cuenta${n == 1 ? '' : 'n'} como vendible:';
    case 'inventory_location':
      return switch (status) {
        PosReadinessStatus.ok => 'La sucursal tiene una ubicación de inventario predeterminada.',
        PosReadinessStatus.warning =>
          'La ubicación predeterminada no permite recepciones: no podrás registrar compras en ella.',
        PosReadinessStatus.missing =>
          'Tienes productos con control de inventario, pero esta sucursal no tiene una ubicación predeterminada. Sin ella no se pueden cobrar esos productos. Créala en Admin. Inventario → Ubicaciones.',
        _ =>
          'Opcional por ahora. La necesitarás antes de vender productos con control de inventario: ahí se reciben y de ahí salen las existencias.',
      };
    case 'inventory_stock':
      return switch (status) {
        PosReadinessStatus.ok => 'Todos los productos con control de inventario tienen existencias disponibles.',
        PosReadinessStatus.warning =>
          '$n ${plural('producto con control de inventario no tiene', 'productos con control de inventario no tienen')} existencias disponibles y no se ${plural('puede', 'pueden')} vender hasta registrar una compra o un ajuste:',
        _ => 'Se evalúa cuando existan productos con control de inventario.',
      };
    case 'cash_session_open':
      return status == PosReadinessStatus.ok
          ? '$n ${plural('caja abierta', 'cajas abiertas')} ahora mismo.'
          : 'No hay cajas abiertas ahora. Se abre desde Corte de Caja o al entrar al Punto de Venta.';
    default:
      return '';
  }
}

/// The existing administration module that fixes a check on [surface]
/// (`ReadinessSurface` in `readiness.types.ts`), or `null` when nothing in
/// the app can fix it (a company-level fault is an ACCESS GO support matter,
/// never something a tenant admin can edit here).
PosModule? posReadinessSurfaceModule(String surface) => switch (surface) {
  'branches' => PosModule.branches,
  'operational_areas' => PosModule.operationalAreas,
  'registers' => PosModule.cash,
  'users' => PosModule.users,
  'catalog' => PosModule.products,
  'prices' => PosModule.products,
  'inventory_locations' => PosModule.inventoryAdmin,
  'inventory_stock' => PosModule.purchases,
  'cash' => PosModule.cash,
  _ => null,
};

String posReadinessSurfaceCta(String surface) => switch (surface) {
  'branches' => 'Ir a Sucursales',
  'operational_areas' => 'Ir a Áreas Operativas',
  'registers' => 'Ir a Corte de Caja',
  'users' => 'Ir a Usuarios',
  'catalog' => 'Ir a Productos',
  'prices' => 'Ir a Productos',
  'inventory_locations' => 'Ir a Admin. Inventario',
  'inventory_stock' => 'Ir a Compras',
  'cash' => 'Ir a Corte de Caja',
  _ => '',
};
