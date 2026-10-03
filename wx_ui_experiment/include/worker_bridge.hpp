#pragma once

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>

#include <nlohmann/json.hpp>
#include <wx/string.h>

class wxProcess;

namespace spike::wxui {

class WorkerBridge final {
public:
    struct Error {
        std::string code;
        std::string message;
        nlohmann::json detail = nlohmann::json::object();
    };

    struct Reply {
        std::uint64_t id = 0;
        bool ok = false;
        nlohmann::json result;
        Error error;
        nlohmann::json raw;
    };

    using Callback = std::function<void(Reply)>;

    WorkerBridge();
    ~WorkerBridge();

    WorkerBridge(const WorkerBridge&) = delete;
    WorkerBridge& operator=(const WorkerBridge&) = delete;

    bool start(const wxString& command, const wxString& working_directory = {});
    bool send(const std::string& method, const nlohmann::json& params, Callback callback);

    // Call regularly from a wxTimer or another UI-thread event handler.
    void poll();
    void cancel();
    void stop();

    // Bounds a request from the time its JSON line has been written. The
    // worker is replaced after a timeout so a late reply cannot satisfy a
    // subsequent request. Values below one millisecond are clamped.
    void set_request_timeout(std::chrono::milliseconds timeout) noexcept;

    [[nodiscard]] bool ready() const noexcept;
    [[nodiscard]] bool busy() const noexcept;
    [[nodiscard]] const Error& last_error() const noexcept;

private:
    static constexpr std::size_t kMaxRequestBytes = 8U * 1024U * 1024U;
    static constexpr std::size_t kMaxResponseLineBytes = 16U * 1024U * 1024U;
    static constexpr std::size_t kMaxDiagnosticBytes = 64U * 1024U;
    static constexpr std::chrono::milliseconds kDefaultRequestTimeout =
        std::chrono::hours(2);

    // True means a client callback was invoked and the bridge may have been
    // destroyed or restarted by that callback. Callers must return at once.
    [[nodiscard]] bool drain_stdout();
    void drain_stderr();
    [[nodiscard]] bool consume_line(std::string line);
    [[nodiscard]] bool launch_stored();
    [[nodiscard]] bool recover_worker(Error& triggering_error, bool automatic);
    [[nodiscard]] bool fail_and_recover(Error error, bool automatic);
    [[nodiscard]] bool process_running() const noexcept;
    void fail_pending(Error error);
    void terminate_process();

    std::unique_ptr<wxProcess> process_;
    long pid_ = 0;
    wxString launch_command_;
    wxString working_directory_;
    std::uint64_t next_id_ = 1;
    std::uint64_t pending_id_ = 0;
    Callback pending_callback_;
    std::chrono::steady_clock::time_point pending_started_{};
    std::chrono::milliseconds request_timeout_{kDefaultRequestTimeout};
    std::string stdout_buffer_;
    std::string stderr_buffer_;
    Error last_error_;
    bool automatic_recovery_used_ = false;
};

}  // namespace spike::wxui
