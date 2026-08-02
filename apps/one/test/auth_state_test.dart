import 'package:as_one/features/authentication/auth_state.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('auth controller publishes only meaningful transitions', () {
    final controller = AuthController(const AuthStatus.unauthenticated());
    var notifications = 0;
    controller.addListener(() => notifications++);
    controller.transition(const AuthStatus.unauthenticated());
    controller.transition(const AuthStatus(AuthPhase.authenticating));
    controller.transition(const AuthStatus.authenticated());
    expect(notifications, 2);
    expect(controller.status.phase, AuthPhase.authenticated);
  });
}
