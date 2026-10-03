// SPDX-License-Identifier: MIT
#pragma once

#include <functional>
#include <string>

#include <nlohmann/json.hpp>

namespace spike::wxui {

struct WorkerRequest final {
    std::string method;
    nlohmann::json params = nlohmann::json::object();
};

enum class SessionSource {
    Empty,
    ImportedDesign,
    UnsavedProject,
    ProjectPackage,
};

// Owns the opaque desktop project snapshot exchanged with the Python worker.
// This class intentionally does not interpret project, EDA, or solver fields.
class ProjectSession final {
public:
    using Json = nlohmann::json;
    using ProjectEdit = std::function<void(Json&)>;

    [[nodiscard]] static WorkerRequest project_open_request(std::string path);
    [[nodiscard]] static WorkerRequest design_import_request(
        std::string path, std::string format_hint = {});

    // worker_result is WorkerBridge::Reply::result, not the complete reply.
    void accept_project_open(std::string path, const Json& worker_result);
    void accept_design_import(std::string path, const Json& worker_result);

    // Promotes a UTF-8 design import into the same legacy-v2 desktop snapshot
    // envelope used by the Tauri UI. The Python worker remains responsible for
    // canonicalization and package writing.
    void create_project_from_import(
        std::string project_name, std::string source_text,
        std::string source_format = "kicad_pcb");

    // Applies an edit transaction to a copy of the retained project. Unknown
    // fields survive unless the edit explicitly removes or replaces them.
    void edit_project(const ProjectEdit& edit);

    [[nodiscard]] WorkerRequest project_save_request(
        std::string destination_path, bool include_results = true) const;
    void accept_project_save(const Json& worker_result);

    void clear() noexcept;

    [[nodiscard]] SessionSource source() const noexcept;
    [[nodiscard]] bool has_project() const noexcept;
    [[nodiscard]] const Json& project() const;
    [[nodiscard]] const Json& source_result() const noexcept;
    [[nodiscard]] const Json* design() const noexcept;
    [[nodiscard]] const std::string& project_path() const noexcept;
    [[nodiscard]] const std::string& design_path() const noexcept;

private:
    SessionSource source_ = SessionSource::Empty;
    Json source_result_;
    Json project_;
    std::string project_path_;
    std::string design_path_;
};

}  // namespace spike::wxui
