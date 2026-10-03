// SPDX-License-Identifier: Apache-2.0
#include "worker_bridge.hpp"

#include <chrono>
#include <functional>
#include <iostream>
#include <string>

#include <wx/app.h>
#include <wx/init.h>
#include <wx/string.h>
#include <wx/utils.h>

namespace {

using namespace std::chrono_literals;
using spike::wxui::WorkerBridge;

bool wait_until(WorkerBridge& bridge, const std::function<bool()>& condition,
                std::chrono::milliseconds timeout = 5s) {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (!condition() && std::chrono::steady_clock::now() < deadline) {
        bridge.poll();
        wxYieldIfNeeded();
        wxMilliSleep(10);
    }
    return condition();
}

bool send_health(WorkerBridge& bridge, bool& completed) {
    return bridge.send("health", nlohmann::json::object(), [&](WorkerBridge::Reply reply) {
        completed = reply.ok && reply.result.value("method", std::string{}) == "health";
    });
}

bool exercise_recovery(WorkerBridge& bridge, const std::string& method,
                       const std::string& expected_error, bool cancel_explicitly = false) {
    bool failure_seen = false;
    bool health_completed = false;
    if (!bridge.send(method, nlohmann::json::object(), [&](WorkerBridge::Reply reply) {
            failure_seen = !reply.ok && reply.error.code == expected_error && bridge.ready();
            if (failure_seen) {
                failure_seen = send_health(bridge, health_completed);
            }
        })) {
        return false;
    }
    if (cancel_explicitly) {
        bridge.cancel();
    }
    return wait_until(bridge, [&] { return failure_seen && health_completed; });
}

}  // namespace

int main(int argc, char** argv) {
    wxInitializer runtime;
    if (!runtime.IsOk() || argc != 3) {
        std::cerr << "usage: worker-bridge-harness <python> <fake_worker.py>\n";
        return 2;
    }

    const wxString command = wxString::Format(
        "\"%s\" -u \"%s\"", wxString::FromUTF8(argv[1]), wxString::FromUTF8(argv[2]));
    WorkerBridge bridge;
    if (!bridge.start(command)) {
        std::cerr << "launch failed: " << bridge.last_error().message << '\n';
        return 3;
    }

    bool health_completed = false;
    if (!send_health(bridge, health_completed) || !wait_until(bridge, [&] { return health_completed; })) {
        std::cerr << "ordinary request failed\n";
        return 4;
    }
    if (!exercise_recovery(bridge, "hang", "client.cancelled", true)) {
        std::cerr << "cancel did not restart the worker safely\n";
        return 5;
    }
    if (!exercise_recovery(bridge, "crash", "client.worker_exited")) {
        std::cerr << "worker exit did not recover\n";
        return 6;
    }
    if (!exercise_recovery(bridge, "malformed", "client.invalid_json")) {
        std::cerr << "protocol failure did not recover\n";
        return 7;
    }

    bridge.set_request_timeout(75ms);
    if (!exercise_recovery(bridge, "hang", "client.timeout")) {
        std::cerr << "request timeout did not recover\n";
        return 8;
    }

    bool destructor_callback = false;
    {
        WorkerBridge temporary;
        if (!temporary.start(command) ||
            !temporary.send("hang", nlohmann::json::object(),
                            [&](WorkerBridge::Reply) { destructor_callback = true; })) {
            std::cerr << "destructor test setup failed\n";
            return 9;
        }
    }
    for (int index = 0; index < 10; ++index) {
        wxYieldIfNeeded();
        wxMilliSleep(5);
    }
    if (destructor_callback) {
        std::cerr << "destructor dispatched an owner callback\n";
        return 10;
    }

    bridge.stop();
    std::cout << "worker bridge recovery checks passed\n";
    return 0;
}
