# Worker bridge recovery harness

This focused native harness launches `fake_worker.py` through `WorkerBridge`
and checks ordinary request handling plus cancellation, worker exit, malformed
protocol output, request timeout, immediate request submission from a recovery
callback, and callback suppression during destruction.

Configure and run it independently of the UI executable:

```powershell
cmake -S wx_ui_experiment/tests/worker_bridge -B wx_ui_experiment/build/worker-bridge-tests `
  -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake `
  -DVCPKG_TARGET_TRIPLET=x64-windows
cmake --build wx_ui_experiment/build/worker-bridge-tests --config Release
ctest --test-dir wx_ui_experiment/build/worker-bridge-tests -C Release --output-on-failure
```

The bridge keeps the original command and working directory. Cancellation and
the first crash, timeout, or protocol failure replace the process before the
request callback runs, allowing that callback to submit the next request. A
second consecutive automatic recovery is suppressed until a valid response is
received, which prevents a broken worker command from creating a restart loop.
Requests have a two-hour default client timeout; callers can select a shorter
positive duration with `set_request_timeout()` for bounded workflows.
