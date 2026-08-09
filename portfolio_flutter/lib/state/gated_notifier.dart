import 'package:flutter/foundation.dart';

/// [ValueNotifier] 변형 - **값 갱신**과 **리스너 통지**를 분리한 notifier.
///
/// 스토어는 정합성을 위해 tick을 항상 즉시 값에 반영하되(값은 최신 유지),
/// 통지는 상황에 따라 미룰 수 있어야 한다:
/// - 상세 화면이 떠 있는 동안 목록 행들의 rebuild를 유발하지 않기 위해 (통지 범위 제한)
/// - 주기 flush 모드(NOTIFY_MS 스윕 벤치마크)에서 통지를 모았다가 한 번에 내보내기 위해
///
/// 미뤄진 통지는 [flushIfDeferred]로 한 번에 방출된다. 값 자체는 언제나 최신이므로
/// 통지가 미뤄져도 그 사이에 value를 읽는 쪽(새로 build되는 위젯 등)은 항상 최신을 본다.
class GatedNotifier<T> extends ChangeNotifier implements ValueListenable<T> {
  GatedNotifier(this._value);

  T _value;
  bool _deferred = false;

  @override
  T get value => _value;

  bool get hasDeferred => _deferred;

  /// 리스너가 붙어 있는지 (= 통지가 실제 rebuild로 이어지는지). 계측용.
  bool get isListened => hasListeners;

  /// 값을 갱신한다. [notify]가 false면 통지를 미루고 deferred 표시만 남긴다.
  void update(T newValue, {required bool notify}) {
    _value = newValue;
    if (notify) {
      _deferred = false;
      notifyListeners();
    } else {
      _deferred = true;
    }
  }

  /// 미뤄진 통지가 있으면 지금 방출한다. 방출했으면 true.
  bool flushIfDeferred() {
    if (_deferred) {
      _deferred = false;
      notifyListeners();
      return true;
    }
    return false;
  }
}
