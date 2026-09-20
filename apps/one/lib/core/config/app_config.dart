enum AsEnvironment { local, test, staging, demo, production }

class AppConfig {
  const AppConfig({
    required this.environment,
    required this.apiBaseUrl,
    required this.appName,
    required this.telemetryEnabled,
  });

  factory AppConfig.fromEnvironment() {
    const environmentName = String.fromEnvironment(
      'AS_ENV',
      defaultValue: 'local',
    );
    final environment = AsEnvironment.values.firstWhere(
      (value) => value.name == environmentName,
      orElse: () => throw StateError('Unsupported AS_ENV: $environmentName'),
    );
    const rawUrl = String.fromEnvironment(
      'AS_API_BASE_URL',
      defaultValue: 'http://localhost:3000',
    );
    final apiBaseUrl = Uri.tryParse(rawUrl);
    if (apiBaseUrl == null || !apiBaseUrl.hasAuthority) {
      throw StateError('AS_API_BASE_URL must be an absolute URL.');
    }
    if (environment != AsEnvironment.local && apiBaseUrl.scheme != 'https') {
      throw StateError('AS_API_BASE_URL must use HTTPS outside local.');
    }
    return AppConfig(
      environment: environment,
      apiBaseUrl: apiBaseUrl,
      // TASK 16.12 — the customer-facing software brand is now ACCESS GO
      // (the browser/OS window title this feeds — see `app.dart`'s
      // `MaterialApp.router(title: ...)`); the `AS_APP_NAME` environment
      // variable NAME itself is unchanged (internal build config, not
      // customer-facing).
      appName: const String.fromEnvironment(
        'AS_APP_NAME',
        defaultValue: 'ACCESS GO',
      ),
      telemetryEnabled: const bool.fromEnvironment('AS_ENABLE_TELEMETRY'),
    );
  }

  final AsEnvironment environment;
  final Uri apiBaseUrl;
  final String appName;
  final bool telemetryEnabled;
}
