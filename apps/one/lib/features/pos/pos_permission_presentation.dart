/// TASK 16.16A — commercial presentation metadata for the technical
/// permission catalogue (`packages/database/src/seeds/technical-
/// permissions.ts`, 104 codes today).
///
/// **This file is presentation ONLY.** It never gates a single
/// authorization decision — every real grant/denial in this app still
/// compares the exact same stable technical codes
/// (`AuthenticatedContext.permissions`, `PosPermission.code`) it always
/// has. This file exists purely so the Usuarios/Roles/Permisos admin UI
/// can show a park/business administrator commercial Spanish terms
/// ("Consultar consolidado de sucursal") instead of the raw developer-
/// facing identifier ("branch_consolidation.read") and the backend's own
/// generic catalogue description ("Approved AS ONE capability: ...").
///
/// A CENTRALIZED mapping, deliberately — every place in this app that
/// needs a commercial permission/category label or description
/// (`_PermissionRow`/`_PermissionDomainGroup` in
/// `pos_user_administration_screen.dart` today) calls into
/// [permissionLabel]/[permissionDescription]/[permissionCategoryLabel]
/// rather than switching on `permission.code`/`domain` itself — see
/// TASK 16.16A's own "do not scatter switch statements across multiple
/// widgets" requirement.
///
/// Every function here has a SAFE FALLBACK for a permission code this
/// file doesn't yet have commercial metadata for (the backend catalogue
/// is server-authoritative and may grow before this file is updated to
/// match — TASK 16.15/16.16 both added new codes over time): never a
/// blank, never a thrown error, and — critically — the fallback NEVER
/// surfaces the raw backend `description` string (which is always
/// "Approved AS ONE capability: <code>" today, `technical-
/// permissions.ts:256`) to a customer. The fallback derives a plain-
/// language guess from the code's own dot-segments instead.
library;

/// A permission's commercial presentation: what a business administrator
/// should read, not what a developer/backend engineer would.
class PermissionPresentation {
  const PermissionPresentation({required this.label, required this.description});

  /// A short, verb-led action a business owner recognizes, e.g.
  /// "Consultar reembolsos" — never the raw `sale.read`-style code.
  final String label;

  /// One plain-language sentence describing exactly what the permission
  /// allows — never claiming more than the technical code actually
  /// grants (TASK 16.16A's own explicit constraint).
  final String description;
}

/// Every permission code this file has authored commercial copy for.
/// Intentionally covers the full current catalogue (104 codes,
/// `technicalPermissionCodes.length` as of TASK 16.16A) — a correctness
/// test (`pos_permission_presentation_test.dart`) asserts every code the
/// live `GET /api/v1/permissions` catalogue could plausibly return still
/// resolves to a REAL entry here, not the generic fallback, so this map
/// drifting out of sync with a newly-added backend code is caught by a
/// test rather than silently degrading in production.
const Map<String, PermissionPresentation> _permissionPresentations = {
  // -- Empresa --------------------------------------------------------
  'company.read': PermissionPresentation(
    label: 'Consultar datos de la empresa',
    description: 'Permite ver la información general de la empresa: nombre, moneda y configuración regional.',
  ),
  'company.update': PermissionPresentation(
    label: 'Editar datos de la empresa',
    description: 'Permite modificar la información general de la empresa.',
  ),
  'company_settings.read': PermissionPresentation(
    label: 'Consultar configuración de la empresa',
    description: 'Permite ver la configuración general de la cuenta (marca del ticket, impresión, preferencias).',
  ),
  'company_settings.update': PermissionPresentation(
    label: 'Editar configuración de la empresa',
    description: 'Permite modificar la configuración general de la cuenta (marca del ticket, impresión, preferencias).',
  ),
  // -- Sucursales -------------------------------------------------------
  'branch.read': PermissionPresentation(
    label: 'Consultar sucursales',
    description: 'Permite ver la lista de sucursales de la empresa.',
  ),
  'branch.create': PermissionPresentation(
    label: 'Crear sucursales',
    description: 'Permite registrar una nueva sucursal.',
  ),
  'branch.update': PermissionPresentation(
    label: 'Editar sucursales',
    description: 'Permite modificar los datos de una sucursal existente.',
  ),
  'branch_settings.read': PermissionPresentation(
    label: 'Consultar configuración de sucursal',
    description: 'Permite ver la configuración propia de una sucursal (horario, zona horaria).',
  ),
  'branch_settings.update': PermissionPresentation(
    label: 'Editar configuración de sucursal',
    description: 'Permite modificar la configuración propia de una sucursal.',
  ),
  // -- Usuarios / Roles / Permisos --------------------------------------
  'user.read': PermissionPresentation(
    label: 'Consultar usuarios',
    description: 'Permite ver la lista de usuarios de la empresa y sus datos de cuenta.',
  ),
  'user.create': PermissionPresentation(
    label: 'Crear usuarios',
    description: 'Permite invitar/dar de alta a un nuevo usuario.',
  ),
  'user.update': PermissionPresentation(
    label: 'Editar usuarios',
    description: 'Permite cambiar el estado de la cuenta de un usuario (activar, suspender, deshabilitar).',
  ),
  'role.read': PermissionPresentation(
    label: 'Consultar roles',
    description: 'Permite ver los roles configurados y sus datos generales.',
  ),
  'role.create': PermissionPresentation(
    label: 'Crear roles',
    description: 'Permite crear un nuevo rol, ya sea desde una plantilla o personalizado.',
  ),
  'role.update': PermissionPresentation(
    label: 'Editar roles',
    description: 'Permite renombrar, describir o activar/desactivar un rol.',
  ),
  'role.permission.manage': PermissionPresentation(
    label: 'Configurar permisos de un rol',
    description: 'Permite elegir qué puede hacer cada rol, marcando o desmarcando permisos individuales.',
  ),
  'role.assign': PermissionPresentation(
    label: 'Asignar roles a usuarios',
    description: 'Permite otorgar o quitar un rol a un usuario, en una sucursal o en toda la empresa.',
  ),
  'permission.read': PermissionPresentation(
    label: 'Consultar catálogo de permisos',
    description: 'Permite ver el catálogo completo de permisos disponibles en el sistema.',
  ),
  'branch_access.manage': PermissionPresentation(
    label: 'Administrar acceso a sucursales/cajas',
    description:
        'Permite otorgar o revocar a un usuario el acceso a una sucursal, y limitarlo a una caja u área operativa específica dentro de ella.',
  ),
  // -- Dispositivos -----------------------------------------------------
  'device.read': PermissionPresentation(
    label: 'Consultar dispositivos',
    description: 'Permite ver los dispositivos (equipos) registrados en una sucursal.',
  ),
  'device.register': PermissionPresentation(
    label: 'Registrar dispositivos',
    description: 'Permite dar de alta un nuevo dispositivo para operar en una sucursal.',
  ),
  'device.revoke': PermissionPresentation(
    label: 'Revocar dispositivos',
    description: 'Permite desactivar el acceso de un dispositivo ya registrado.',
  ),
  // -- Cajas --------------------------------------------------------------
  'cash_register.read': PermissionPresentation(
    label: 'Consultar cajas',
    description: 'Permite ver la lista de cajas registradoras de una sucursal.',
  ),
  'cash_register.manage': PermissionPresentation(
    label: 'Administrar cajas',
    description: 'Permite crear cajas registradoras y asignarlas a un área operativa.',
  ),
  'cash_session.read': PermissionPresentation(
    label: 'Consultar turnos de caja',
    description: 'Permite ver el estado y los movimientos de un turno de caja.',
  ),
  'cash_session.open': PermissionPresentation(
    label: 'Abrir turno de caja',
    description: 'Permite abrir un turno de caja con un fondo inicial.',
  ),
  'cash_movement.create': PermissionPresentation(
    label: 'Registrar entradas/salidas de efectivo',
    description: 'Permite registrar una entrada o salida de efectivo durante un turno de caja.',
  ),
  'cash_session.close': PermissionPresentation(
    label: 'Cerrar turno de caja',
    description: 'Permite cerrar un turno de caja, contar el efectivo y registrar el corte final.',
  ),
  // -- Áreas operativas / Consolidado de sucursal ------------------------
  'operational_area.read': PermissionPresentation(
    label: 'Consultar áreas operativas',
    description: 'Permite ver las áreas operativas configuradas en una sucursal (por ejemplo, taquilla o alimentos).',
  ),
  'operational_area.manage': PermissionPresentation(
    label: 'Administrar áreas operativas',
    description: 'Permite crear, renombrar o desactivar un área operativa y asignarle cajas.',
  ),
  'branch_consolidation.read': PermissionPresentation(
    label: 'Consultar consolidado de sucursal',
    description: 'Permite ver el resumen consolidado de ventas y efectivo de todas las cajas de una sucursal.',
  ),
  // -- Catálogo -------------------------------------------------------
  'catalog.read': PermissionPresentation(
    label: 'Consultar catálogo',
    description: 'Permite ver productos, variantes, categorías y marcas.',
  ),
  'category.manage': PermissionPresentation(
    label: 'Administrar categorías',
    description: 'Permite crear, editar y organizar las categorías del catálogo.',
  ),
  'product.manage': PermissionPresentation(
    label: 'Administrar productos',
    description: 'Permite crear y editar productos, variantes y marcas.',
  ),
  'price.manage': PermissionPresentation(
    label: 'Administrar precios',
    description: 'Permite cambiar precios y configurar precios especiales por sucursal.',
  ),
  'availability.manage': PermissionPresentation(
    label: 'Administrar disponibilidad',
    description: 'Permite activar o pausar la venta de un producto en una sucursal.',
  ),
  // -- Inventario ---------------------------------------------------------
  'inventory.read': PermissionPresentation(
    label: 'Consultar inventario',
    description: 'Permite ver las existencias de productos por sucursal/almacén.',
  ),
  'inventory.cost.read': PermissionPresentation(
    label: 'Consultar costos de inventario',
    description: 'Permite ver el costo de los productos en inventario.',
  ),
  'inventory_location.manage': PermissionPresentation(
    label: 'Administrar almacenes',
    description: 'Permite crear y configurar ubicaciones/almacenes de inventario.',
  ),
  'inventory.adjust': PermissionPresentation(
    label: 'Ajustar inventario',
    description: 'Permite corregir manualmente la cantidad de existencias de un producto.',
  ),
  'inventory.approve': PermissionPresentation(
    label: 'Aprobar ajustes de inventario',
    description: 'Permite aprobar un ajuste de inventario propuesto por otro usuario.',
  ),
  'inventory.count': PermissionPresentation(
    label: 'Realizar conteos de inventario',
    description: 'Permite crear y capturar un conteo físico de inventario.',
  ),
  'inventory.reverse': PermissionPresentation(
    label: 'Revertir movimientos de inventario',
    description: 'Permite deshacer un movimiento de inventario ya registrado.',
  ),
  'inventory.reservation.manage': PermissionPresentation(
    label: 'Administrar reservas de inventario',
    description: 'Permite crear y liberar reservas de existencias.',
  ),
  'inventory.reconcile': PermissionPresentation(
    label: 'Conciliar inventario',
    description: 'Permite revisar y resolver diferencias encontradas en un conteo de inventario.',
  ),
  'inventory.transfer': PermissionPresentation(
    label: 'Enviar traspasos de inventario',
    description: 'Permite crear, enviar o cancelar un traspaso de existencias entre sucursales.',
  ),
  'inventory.receive': PermissionPresentation(
    label: 'Recibir traspasos de inventario',
    description: 'Permite confirmar la recepción de existencias en un traspaso entre sucursales.',
  ),
  // -- Ventas -----------------------------------------------------------
  'sale.read': PermissionPresentation(
    label: 'Consultar ventas',
    description: 'Permite ver el historial y el detalle de las ventas.',
  ),
  'sale.create': PermissionPresentation(
    label: 'Registrar ventas',
    description: 'Permite crear una venta y agregar productos al ticket.',
  ),
  'sale.complete': PermissionPresentation(
    label: 'Completar ventas',
    description: 'Permite finalizar una venta una vez cobrada.',
  ),
  'sale.cancel': PermissionPresentation(
    label: 'Cancelar ventas',
    description: 'Permite cancelar una venta.',
  ),
  // -- Pagos ------------------------------------------------------------
  'payment.read': PermissionPresentation(
    label: 'Consultar pagos',
    description: 'Permite ver los pagos registrados de una venta.',
  ),
  'payment.create': PermissionPresentation(
    label: 'Cobrar ventas',
    description: 'Permite registrar un pago (efectivo, tarjeta u otro medio) para una venta.',
  ),
  'payment.reverse': PermissionPresentation(
    label: 'Revertir pagos',
    description: 'Permite revertir un pago ya registrado.',
  ),
  // -- Reembolsos ---------------------------------------------------------
  'refund.read': PermissionPresentation(
    label: 'Consultar reembolsos',
    description: 'Permite ver el historial y el detalle de las devoluciones y reembolsos.',
  ),
  'refund.create': PermissionPresentation(
    label: 'Registrar reembolsos',
    description: 'Permite iniciar una devolución o reembolso de una venta.',
  ),
  'refund.approve': PermissionPresentation(
    label: 'Aprobar reembolsos',
    description: 'Permite aprobar un reembolso que fue iniciado por otro usuario.',
  ),
  'refund.complete': PermissionPresentation(
    label: 'Completar reembolsos',
    description: 'Permite finalizar un reembolso, devolviendo el dinero al cliente.',
  ),
  'refund.cancel': PermissionPresentation(
    label: 'Cancelar reembolsos',
    description: 'Permite cancelar una solicitud de reembolso.',
  ),
  // -- Promociones y cupones ----------------------------------------------
  'promotion.read': PermissionPresentation(
    label: 'Consultar promociones',
    description: 'Permite ver las promociones configuradas.',
  ),
  'promotion.manage': PermissionPresentation(
    label: 'Administrar promociones',
    description: 'Permite crear, editar y activar/desactivar promociones.',
  ),
  'coupon.read': PermissionPresentation(
    label: 'Consultar cupones',
    description: 'Permite ver los cupones configurados.',
  ),
  'coupon.manage': PermissionPresentation(
    label: 'Administrar cupones',
    description: 'Permite crear, editar y activar/desactivar cupones.',
  ),
  'discount.apply': PermissionPresentation(
    label: 'Aplicar descuentos en el mostrador',
    description: 'Permite aplicar un descuento manual al cobrar una venta.',
  ),
  // -- Clientes -----------------------------------------------------------
  'customer.read': PermissionPresentation(
    label: 'Consultar clientes',
    description: 'Permite buscar y ver los datos de un cliente.',
  ),
  'customer.create': PermissionPresentation(
    label: 'Registrar clientes',
    description: 'Permite dar de alta a un nuevo cliente.',
  ),
  'customer.update': PermissionPresentation(
    label: 'Editar clientes',
    description: 'Permite modificar los datos de un cliente ya registrado.',
  ),
  // -- Membresías / Lealtad / Recompensas --------------------------------
  'membership.read': PermissionPresentation(
    label: 'Consultar membresías',
    description: 'Permite ver los planes de membresía y las membresías activas de los clientes.',
  ),
  'membership.manage': PermissionPresentation(
    label: 'Administrar planes de membresía',
    description: 'Permite crear y editar planes de membresía.',
  ),
  'membership.issue': PermissionPresentation(
    label: 'Emitir membresías',
    description: 'Permite emitir o renovar la membresía de un cliente en el mostrador.',
  ),
  'loyalty.read': PermissionPresentation(
    label: 'Consultar programa de lealtad',
    description: 'Permite ver el saldo y el historial de puntos/sellos de lealtad de un cliente.',
  ),
  'loyalty.manage': PermissionPresentation(
    label: 'Administrar programa de lealtad',
    description: 'Permite configurar las reglas del programa de lealtad.',
  ),
  'loyalty.adjust': PermissionPresentation(
    label: 'Corregir saldo de lealtad',
    description: 'Permite hacer una corrección manual al saldo de puntos/sellos de un cliente.',
  ),
  'reward.read': PermissionPresentation(
    label: 'Consultar recompensas',
    description: 'Permite ver las recompensas disponibles de un cliente.',
  ),
  'reward.redeem': PermissionPresentation(
    label: 'Canjear recompensas',
    description: 'Permite canjear una recompensa de un cliente en el mostrador.',
  ),
  'reward.issue': PermissionPresentation(
    label: 'Emitir recompensas',
    description: 'Permite otorgar manualmente una recompensa a un cliente.',
  ),
  'reward.revoke': PermissionPresentation(
    label: 'Revocar recompensas',
    description: 'Permite anular una recompensa ya otorgada.',
  ),
  // -- Sistema / Auditoría --------------------------------------------
  'sync.execute': PermissionPresentation(
    label: 'Ejecutar sincronización',
    description: 'Permite forzar una sincronización manual de datos.',
  ),
  'audit.read': PermissionPresentation(
    label: 'Consultar bitácora',
    description: 'Permite ver el historial de acciones realizadas por los usuarios (bitácora de auditoría).',
  ),
  'recovery.read': PermissionPresentation(
    label: 'Consultar recuperación de datos',
    description: 'Permite ver las herramientas de recuperación ante errores de sincronización.',
  ),
  // -- Fiestas ------------------------------------------------------------
  'party.read': PermissionPresentation(
    label: 'Consultar reservaciones de fiestas',
    description: 'Permite ver el calendario y el detalle de las reservaciones de fiestas/eventos.',
  ),
  'party.manage': PermissionPresentation(
    label: 'Administrar reservaciones de fiestas',
    description: 'Permite crear y editar reservaciones, salones y paquetes de fiestas/eventos.',
  ),
  'party.cancel': PermissionPresentation(
    label: 'Cancelar reservaciones de fiestas',
    description: 'Permite cancelar una reservación de fiesta/evento ya existente.',
  ),
  'party.payment.record': PermissionPresentation(
    label: 'Registrar pagos de fiestas',
    description: 'Permite registrar un anticipo, saldo o pago adicional de una reservación de fiesta/evento.',
  ),
  // -- Ventas en espera / Compras ------------------------------------------
  'held_sale.manage': PermissionPresentation(
    label: 'Suspender y reanudar ventas',
    description: 'Permite dejar un ticket en espera y reanudarlo más tarde.',
  ),
  'purchase.read': PermissionPresentation(
    label: 'Consultar compras',
    description: 'Permite ver las órdenes de compra y el historial de compra directa.',
  ),
  'purchase.create': PermissionPresentation(
    label: 'Registrar compras',
    description: 'Permite crear una orden de compra o una compra directa a un proveedor.',
  ),
  'purchase.receive': PermissionPresentation(
    label: 'Recibir mercancía comprada',
    description: 'Permite confirmar la recepción de mercancía de una orden de compra, dando entrada al inventario.',
  ),
  // -- Personal -------------------------------------------------------------
  'employee.read': PermissionPresentation(
    label: 'Consultar empleados',
    description: 'Permite ver la lista de empleados y sus datos.',
  ),
  'employee.manage': PermissionPresentation(
    label: 'Administrar empleados',
    description: 'Permite dar de alta, editar o dar de baja a un empleado.',
  ),
  'schedule.read': PermissionPresentation(
    label: 'Consultar horarios',
    description: 'Permite ver los horarios asignados a los empleados.',
  ),
  'schedule.manage': PermissionPresentation(
    label: 'Administrar horarios',
    description: 'Permite crear y editar los horarios de los empleados.',
  ),
  'attendance.read': PermissionPresentation(
    label: 'Consultar checador',
    description: 'Permite ver los registros de entrada/salida de los empleados.',
  ),
  'attendance.manage': PermissionPresentation(
    label: 'Administrar checador',
    description: 'Permite corregir manualmente un registro de entrada/salida.',
  ),
  'payroll.read': PermissionPresentation(
    label: 'Consultar nómina',
    description: 'Permite ver los periodos y montos de nómina.',
  ),
  'payroll.manage': PermissionPresentation(
    label: 'Administrar nómina',
    description: 'Permite preparar y editar un periodo de nómina.',
  ),
  'payroll.close': PermissionPresentation(
    label: 'Cerrar periodos de nómina',
    description: 'Permite cerrar de forma definitiva un periodo de nómina ya calculado.',
  ),
  // -- Proveedores ----------------------------------------------------
  'supplier.read': PermissionPresentation(
    label: 'Consultar proveedores',
    description: 'Permite ver el directorio de proveedores.',
  ),
  'supplier.manage': PermissionPresentation(
    label: 'Administrar proveedores',
    description: 'Permite crear, editar y dar de baja proveedores.',
  ),
  // -- Reportes -------------------------------------------------------------
  'report.read': PermissionPresentation(
    label: 'Consultar reportes',
    description: 'Permite ver el Centro de Reportes: ventas, financiero, inventario, clientes, empleados y accesos.',
  ),
  // -- Control de acceso ------------------------------------------------
  'access.scan': PermissionPresentation(
    label: 'Escanear accesos',
    description: 'Permite escanear boletos/pulseras y registrar entradas y salidas.',
  ),
  'access.read': PermissionPresentation(
    label: 'Consultar accesos',
    description: 'Permite ver el aforo actual y el historial de entradas/salidas.',
  ),
  'access.manage': PermissionPresentation(
    label: 'Administrar accesos',
    description: 'Permite anular un pase/pulsera y realizar correcciones administrativas de control de acceso.',
  ),
  // -- Credenciales de personal -----------------------------------------
  'staff_credential.manage': PermissionPresentation(
    label: 'Administrar credenciales de acceso rápido',
    description: 'Permite asignar o revocar el PIN/código QR que un empleado usa para iniciar sesión rápidamente.',
  ),
};

/// Every permission-category (`domain`) label this file has authored —
/// extends/replaces `pos_user_administration_screen.dart`'s own
/// pre-existing (pre-TASK-16.16A) `_domainLabels` map with the same
/// entries plus the two domains TASK 16.15 introduced afterward
/// (`operational_area`, `branch_consolidation`), which had been silently
/// falling back to a raw capitalized string ("Branch consolidation") —
/// exactly the kind of leak TASK 16.16A exists to close. `access`'s own
/// label is deliberately "Control de acceso" (not the older, vaguer
/// "Accesos") to match this task's own worked example.
const Map<String, String> _permissionCategoryLabels = {
  'company': 'Empresa',
  'company_settings': 'Configuración de la empresa',
  'branch': 'Sucursales',
  'branch_settings': 'Configuración de sucursal',
  'user': 'Usuarios',
  'role': 'Roles y permisos',
  'permission': 'Catálogo de permisos',
  'branch_access': 'Acceso a sucursales',
  'device': 'Dispositivos',
  'cash_register': 'Cajas',
  'cash_session': 'Apertura y cierre de caja',
  'cash_movement': 'Movimientos de caja',
  'operational_area': 'Áreas operativas',
  'branch_consolidation': 'Consolidado de sucursal',
  'catalog': 'Catálogo',
  'category': 'Categorías',
  'product': 'Productos',
  'price': 'Precios',
  'availability': 'Disponibilidad',
  'inventory': 'Inventario',
  'sale': 'Ventas',
  'payment': 'Pagos',
  'refund': 'Reembolsos',
  'promotion': 'Promociones',
  'coupon': 'Cupones',
  'discount': 'Descuentos',
  'customer': 'Clientes',
  'membership': 'Membresías',
  'loyalty': 'Lealtad',
  'reward': 'Recompensas',
  'sync': 'Sincronización',
  'audit': 'Auditoría',
  'recovery': 'Recuperación de datos',
  'party': 'Fiestas',
  'held_sale': 'Ventas en espera',
  'purchase': 'Compras',
  'employee': 'Empleados',
  'schedule': 'Horarios',
  'attendance': 'Checador',
  'payroll': 'Nómina',
  'supplier': 'Proveedores',
  'report': 'Reportes',
  'access': 'Control de acceso',
  'staff_credential': 'Credenciales de personal',
};

/// A human-readable Spanish label for a permission CATEGORY (`domain` —
/// the text before its first `.`, e.g. `sale.create` → `sale` →
/// "Ventas"). An unknown future domain falls back to a capitalized,
/// underscore-stripped version of the raw string — never blank, never a
/// thrown error, since the backend catalogue is authoritative and may
/// grow before this file catches up.
String permissionCategoryLabel(String domain) {
  final label = _permissionCategoryLabels[domain];
  if (label != null) return label;
  if (domain.isEmpty) return domain;
  return domain[0].toUpperCase() + domain.substring(1).replaceAll('_', ' ');
}

/// A short, commercial, verb-led Spanish label for a permission code —
/// what an admin should read as the PRIMARY text for a permission row.
/// Never the raw code. An unmapped future code falls back to a plain-
/// language guess derived from its own dot-segments (e.g.
/// `widget.manage` → "Administrar widget") — still never the raw code
/// itself, and never a thrown error.
String permissionLabel(String code) {
  final entry = _permissionPresentations[code];
  if (entry != null) return entry.label;
  return _fallbackLabel(code);
}

/// A plain-language Spanish description for a permission code — what an
/// admin should read as the SECONDARY text for a permission row. Never
/// the backend's own raw `description` field (always "Approved AS ONE
/// capability: <code>" today — see this file's own header comment) —
/// callers must pass this function's return value, never
/// `PosPermission.description` directly, to guarantee that string can
/// never reach a customer-facing screen even for an unmapped future
/// code. An unmapped code gets a generic, honest fallback sentence
/// built from its own category and action segments — never a lie about
/// broader capability than the code actually grants, and never blank
/// (a `null`/blank description would look broken, not honest, in this
/// UI's existing layout).
String permissionDescription(String code) {
  final entry = _permissionPresentations[code];
  if (entry != null) return entry.description;
  final category = permissionCategoryLabel(code.split('.').first).toLowerCase();
  return 'Permiso técnico del sistema relacionado con $category.';
}

/// Derives a generic-but-honest label for a permission code this file
/// has no authored entry for, from its own dot-segments — e.g.
/// `widget.manage` → "Administrar widget", `widget.read` → "Consultar
/// widget", an unrecognized action segment → "widget: action" (a plain,
/// no-worse-than-the-raw-code sentence, never blank).
String _fallbackLabel(String code) {
  final segments = code.split('.');
  final category = permissionCategoryLabel(segments.first).toLowerCase();
  final action = segments.length > 1 ? segments.last : '';
  const verbs = {
    'read': 'Consultar',
    'manage': 'Administrar',
    'create': 'Crear',
    'update': 'Editar',
    'open': 'Abrir',
    'close': 'Cerrar',
    'apply': 'Aplicar',
    'cancel': 'Cancelar',
    'complete': 'Completar',
    'approve': 'Aprobar',
    'reverse': 'Revertir',
    'issue': 'Emitir',
    'revoke': 'Revocar',
    'redeem': 'Canjear',
    'adjust': 'Corregir',
    'assign': 'Asignar',
    'execute': 'Ejecutar',
    'scan': 'Escanear',
    'receive': 'Recibir',
    'record': 'Registrar',
    'count': 'Contar',
    'reconcile': 'Conciliar',
    'transfer': 'Enviar',
  };
  final verb = verbs[action];
  if (verb != null) return '$verb $category';
  if (action.isEmpty) return category[0].toUpperCase() + category.substring(1);
  return '$category: ${action.replaceAll('_', ' ')}';
}
