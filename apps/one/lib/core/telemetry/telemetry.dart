import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../config/app_config.dart';

abstract interface class Telemetry {
  void recordEvent(String name, {Map<String, Object?> attributes = const {}});
  void recordFailure(String operation, Object error);
}

class SafeTelemetry implements Telemetry {
  const SafeTelemetry(this.environment);
  final AsEnvironment environment;
  @override
  void recordEvent(String name, {Map<String, Object?> attributes = const {}}) {
    if (kDebugMode && environment == AsEnvironment.local) {
      debugPrint('[AS ONE] event=$name');
    }
  }

  @override
  void recordFailure(String operation, Object error) {
    if (kDebugMode && environment == AsEnvironment.local) {
      debugPrint('[AS ONE] failure=$operation type=${error.runtimeType}');
    }
  }
}

class TelemetryRouteObserver extends NavigatorObserver {
  TelemetryRouteObserver(this.telemetry);
  final Telemetry telemetry;
  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    telemetry.recordEvent(
      'route.change',
      attributes: {'route': route.settings.name ?? 'unnamed'},
    );
    super.didPush(route, previousRoute);
  }
}
