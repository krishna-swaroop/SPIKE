#include "worker_bridge.hpp"

#include <algorithm>
#include <chrono>
#include <utility>

#include <wx/process.h>
#include <wx/stream.h>
#include <wx/utils.h>

namespace spike::wxui {
namespace {

// wxProcess deletes itself when an unhandled termination notification is
// delivered. Keep that notification under explicit ownership while the bridge
// uses the streams, then hand the object back to wxWidgets if shutdown is still
// in flight. This prevents both a dangling unique_ptr and deleting an object
// that the async process monitor still references.
class ManagedProcess final : public wxProcess {
public:
    void OnTerminate(int, int) override {
        terminated_ = true;
        if (!bridge_owned_) {
            delete this;
        }
    }

    [[nodiscard]] bool terminated() const noexcept { return terminated_; }

    void release_to_wx() {
        bridge_owned_ = false;
        Detach();
        if (terminated_) {
            delete this;
        }
    }

private:
    bool bridge_owned_ = true;
    bool terminated_ = false;
};

WorkerBridge::Error make_error(std::string code, std::string message,
                               nlohmann::json detail = nlohmann::json::object()) {
    return {std::move(code), std::move(message), std::move(detail)};
}

std::string json_string(const nlohmann::json& value, const char* key) {
    const auto found = value.find(key);
    return found != value.end() && found->is_string() ? found->get<std::string>() : std::string{};
}

}  // namespace

WorkerBridge::WorkerBridge() = default;

WorkerBridge::~WorkerBridge() {
    // Owner callbacks commonly capture the window that owns this bridge. Do
    // not dispatch one while that owner is already being destroyed.
    pending_callback_ = {};
    pending_id_ = 0;
    terminate_process();
}

bool WorkerBridge::start(const wxString& command, const wxString& working_directory) {
    if (command.empty()) {
        last_error_ = make_error("client.invalid_command", "Worker command is empty.");
        return false;
    }
    if (busy()) {
        last_error_ = make_error(
            "client.busy", "The running worker request must finish or be cancelled before restart.");
        return false;
    }

    terminate_process();
    launch_command_ = command;
    working_directory_ = working_directory;
    automatic_recovery_used_ = false;
    return launch_stored();
}

bool WorkerBridge::launch_stored() {
    stdout_buffer_.clear();
    stderr_buffer_.clear();
    if (launch_command_.empty()) {
        last_error_ = make_error("client.invalid_command", "No worker launch command is available.");
        return false;
    }

    auto candidate = std::make_unique<ManagedProcess>();
    candidate->Redirect();
    wxExecuteEnv environment;
    environment.cwd = working_directory_;
    const long candidate_pid = wxExecute(
        launch_command_, wxEXEC_ASYNC | wxEXEC_MAKE_GROUP_LEADER, candidate.get(), &environment);
    if (candidate_pid <= 0) {
        pid_ = 0;
        last_error_ = make_error("client.launch_failed", "The SPIKE worker could not be started.");
        return false;
    }
    process_ = std::move(candidate);
    pid_ = candidate_pid;
    last_error_ = {};
    return true;
}

bool WorkerBridge::send(const std::string& method, const nlohmann::json& params,
                        Callback callback) {
    if (!ready()) {
        last_error_ = make_error("client.not_ready", "The SPIKE worker is not running or already has a request.");
        return false;
    }
    if (method.empty() || !params.is_object() || !callback) {
        last_error_ = make_error(
            "client.invalid_request",
            "Worker method and callback are required, and params must be an object.");
        return false;
    }

    const std::uint64_t id = next_id_++;
    std::string encoded;
    try {
        encoded = nlohmann::json{{"id", id}, {"method", method}, {"params", params}}.dump();
    } catch (const std::exception& exception) {
        last_error_ = make_error("client.serialization_failed", exception.what());
        return false;
    }
    encoded.push_back('\n');
    if (encoded.size() > kMaxRequestBytes) {
        last_error_ = make_error("client.request_too_large", "Worker request exceeds the client size limit.");
        return false;
    }

    wxOutputStream* input = process_->GetOutputStream();
    if (input == nullptr || !input->IsOk()) {
        Error error = make_error("client.stdin_unavailable", "Worker input stream is unavailable.");
        terminate_process();
        (void)recover_worker(error, true);
        last_error_ = std::move(error);
        return false;
    }
    input->Write(encoded.data(), encoded.size());
    if (input->LastWrite() != encoded.size() || !input->IsOk()) {
        Error error = make_error("client.write_failed", "The request could not be written to the worker.");
        terminate_process();
        (void)recover_worker(error, true);
        last_error_ = std::move(error);
        return false;
    }

    pending_id_ = id;
    pending_callback_ = std::move(callback);
    pending_started_ = std::chrono::steady_clock::now();
    return true;
}

void WorkerBridge::poll() {
    if (!process_) {
        return;
    }
    if (drain_stdout()) {
        return;
    }
    if (!process_) {
        return;
    }
    drain_stderr();
    if (pid_ > 0 && (!process_running() || !wxProcess::Exists(pid_))) {
        Error error = make_error(
            "client.worker_exited", "The SPIKE worker exited before completing the request.",
            {{"stderr", stderr_buffer_}});
        if (busy()) {
            (void)fail_and_recover(std::move(error), true);
        } else {
            terminate_process();
            const bool restarted = recover_worker(error, true);
            last_error_ = restarted ? Error{} : error;
        }
        return;
    }
    if (busy() && std::chrono::steady_clock::now() - pending_started_ >= request_timeout_) {
        Error error = make_error(
            "client.timeout", "The worker request exceeded the client timeout.",
            {{"timeout_ms", request_timeout_.count()}});
        (void)fail_and_recover(std::move(error), true);
    }
}

void WorkerBridge::cancel() {
    if (!busy()) {
        return;
    }
    Error error = make_error("client.cancelled", "The worker request was cancelled.");
    terminate_process();
    automatic_recovery_used_ = false;
    const bool restarted = recover_worker(error, false);
    if (restarted) {
        last_error_ = error;
    }
    // Callback dispatch is deliberately the final operation: it may close the
    // owning window or immediately submit work to the replacement process.
    fail_pending(error);
}

void WorkerBridge::stop() {
    terminate_process();
    stdout_buffer_.clear();
    stderr_buffer_.clear();
    automatic_recovery_used_ = false;
    const Error error = make_error("client.stopped", "The SPIKE worker was stopped.");
    last_error_ = error;
    // As in cancel(), do not touch bridge state after invoking client code.
    fail_pending(error);
}

void WorkerBridge::set_request_timeout(std::chrono::milliseconds timeout) noexcept {
    request_timeout_ = std::max(timeout, std::chrono::milliseconds{1});
}

bool WorkerBridge::ready() const noexcept {
    return process_running() && !pending_callback_;
}

bool WorkerBridge::busy() const noexcept {
    return static_cast<bool>(pending_callback_);
}

const WorkerBridge::Error& WorkerBridge::last_error() const noexcept {
    return last_error_;
}

bool WorkerBridge::drain_stdout() {
    wxInputStream* output = process_->GetInputStream();
    if (output == nullptr) {
        return false;
    }
    char chunk[4096];
    while (process_->IsInputAvailable()) {
        output->Read(chunk, sizeof(chunk));
        const auto count = output->LastRead();
        if (count == 0) {
            break;
        }
        stdout_buffer_.append(chunk, count);
        if (stdout_buffer_.size() > kMaxResponseLineBytes) {
            return fail_and_recover(
                make_error("client.response_too_large", "Worker response exceeds the client size limit."),
                true);
        }
        std::size_t newline = 0;
        while ((newline = stdout_buffer_.find('\n')) != std::string::npos) {
            std::string line = stdout_buffer_.substr(0, newline);
            stdout_buffer_.erase(0, newline + 1);
            if (!line.empty() && line.back() == '\r') {
                line.pop_back();
            }
            if (!line.empty()) {
                if (consume_line(std::move(line))) {
                    return true;
                }
            }
        }
    }
    return false;
}

void WorkerBridge::drain_stderr() {
    wxInputStream* error = process_->GetErrorStream();
    if (error == nullptr) {
        return;
    }
    char chunk[2048];
    while (process_->IsErrorAvailable()) {
        error->Read(chunk, sizeof(chunk));
        const auto count = error->LastRead();
        if (count == 0) {
            break;
        }
        const std::size_t available = kMaxDiagnosticBytes - std::min(stderr_buffer_.size(), kMaxDiagnosticBytes);
        stderr_buffer_.append(chunk, std::min<std::size_t>(count, available));
    }
}

bool WorkerBridge::consume_line(std::string line) {
    nlohmann::json response;
    try {
        response = nlohmann::json::parse(line);
    } catch (const std::exception& exception) {
        return fail_and_recover(
            make_error("client.invalid_json", "Worker emitted invalid JSON.",
                       {{"reason", exception.what()}}),
            true);
    }
    if (!response.is_object() || !response.contains("id") || !response["id"].is_number_unsigned() ||
        response["id"].get<std::uint64_t>() != pending_id_) {
        return fail_and_recover(
            make_error("client.response_mismatch", "Worker response does not match the pending request."),
            true);
    }
    const auto ok = response.find("ok");
    if (ok == response.end() || !ok->is_boolean()) {
        return fail_and_recover(
            make_error("client.invalid_response", "Worker response is missing a Boolean ok field."),
            true);
    }

    Reply reply;
    reply.id = pending_id_;
    reply.raw = response;
    reply.ok = ok->get<bool>();
    if (reply.ok) {
        reply.result = response.value("result", nlohmann::json{});
    } else {
        reply.error.code = json_string(response, "error_code");
        reply.error.message = json_string(response, "error");
        reply.error.detail = response.value("error_detail", nlohmann::json::object());
        if (reply.error.code.empty()) {
            reply.error.code = "client.worker_error";
        }
        if (reply.error.message.empty()) {
            reply.error.message = "The worker rejected the request.";
        }
        last_error_ = reply.error;
    }
    Callback callback = std::move(pending_callback_);
    pending_id_ = 0;
    automatic_recovery_used_ = false;
    if (callback) {
        callback(std::move(reply));
        return true;
    }
    return false;
}

bool WorkerBridge::recover_worker(Error& triggering_error, bool automatic) {
    if (automatic && automatic_recovery_used_) {
        triggering_error.detail["worker_restarted"] = false;
        triggering_error.detail["restart_suppressed"] = true;
        return false;
    }
    if (automatic) {
        automatic_recovery_used_ = true;
    }
    const bool restarted = launch_stored();
    triggering_error.detail["worker_restarted"] = restarted;
    if (!restarted) {
        triggering_error.detail["restart_error"] = {
            {"code", last_error_.code}, {"message", last_error_.message}};
    }
    return restarted;
}

bool WorkerBridge::fail_and_recover(Error error, bool automatic) {
    terminate_process();
    const bool restarted = recover_worker(error, automatic);
    if (restarted) {
        last_error_ = error;
    }
    fail_pending(std::move(error));
    return true;
}

bool WorkerBridge::process_running() const noexcept {
    const auto* managed = static_cast<const ManagedProcess*>(process_.get());
    return managed != nullptr && pid_ > 0 && !managed->terminated();
}

void WorkerBridge::fail_pending(Error error) {
    Callback callback = std::move(pending_callback_);
    const std::uint64_t id = pending_id_;
    pending_id_ = 0;
    if (callback) {
        Reply reply;
        reply.id = id;
        reply.error = std::move(error);
        callback(std::move(reply));
    }
}

void WorkerBridge::terminate_process() {
    if (!process_) {
        return;
    }
    if (pid_ > 0 && wxProcess::Exists(pid_)) {
        wxProcess::Kill(pid_, wxSIGKILL, wxKILL_CHILDREN);
    }
    auto* managed = static_cast<ManagedProcess*>(process_.release());
    managed->release_to_wx();
    pid_ = 0;
}

}  // namespace spike::wxui
